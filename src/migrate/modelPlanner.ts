/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/migrate/modelPlanner.ts
//
// Topological ordering for migrations: a generic DFS shared by the
// model-level sort (parent tables before children, derived from FK
// references) and the module-level sort (modules owning referenced tables
// before the modules referencing them). Cycles throw with the cycle path in
// the message.

import type { IMain } from 'pg-promise';
import type { DbConnection, Logger, RepositoryCtor } from '../schemaTypes.js';
import type { ModuleDescriptor } from './types.js';

/**
 * Structural shape of a table-backed model instance: a `schema` with a
 * resolved dbSchema/table and a `createTable` method.
 */
export interface TableModelLike {
  schema: {
    dbSchema: string;
    table: string;
    constraints?: {
      foreignKeys?: {
        references?: { table?: string; schema?: string };
      }[];
    };
  };
  createTable(): Promise<unknown>;
}

/** Structural shape of a model that can be rebound to a schema. */
interface SchemaBindable {
  forSchema(schemaName: string): unknown;
}

/**
 * Type guard for {@link TableModelLike}.
 *
 * @param value - Candidate model instance.
 * @returns True when the value has a createTable function and a schema with
 *   dbSchema and table.
 */
export function isTableModel(value: unknown): value is TableModelLike {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<TableModelLike>;
  return (
    typeof candidate.createTable === 'function' &&
    typeof candidate.schema === 'object' &&
    candidate.schema !== null &&
    typeof candidate.schema.dbSchema === 'string' &&
    typeof candidate.schema.table === 'string'
  );
}

/**
 * Canonical graph key for a model: `"<dbSchema>.<table>"`, lowercased.
 *
 * @param model - Table model instance.
 * @returns The lowercased schema-qualified table key.
 */
export function getModelKey(model: TableModelLike): string {
  return `${model.schema.dbSchema}.${model.schema.table}`.toLowerCase();
}

/**
 * Extracts the schema-qualified tables a model's foreign keys reference.
 * A dotted `references.table` wins; otherwise the target is qualified with
 * `references.schema`, falling back to the model's own dbSchema.
 *
 * @param model - Table model instance.
 * @returns Deduplicated, lowercased `"schema.table"` keys.
 */
export function getTableDependencies(model: TableModelLike): string[] {
  const deps = new Set<string>();
  for (const fk of model.schema.constraints?.foreignKeys ?? []) {
    const table = fk.references?.table;
    if (!table) continue;
    if (table.includes('.')) {
      deps.add(table.toLowerCase());
    } else {
      const schema = fk.references?.schema ?? model.schema.dbSchema;
      deps.add(`${schema}.${table}`.toLowerCase());
    }
  }
  return Array.from(deps);
}

/**
 * Generic dependency-first topological sort (DFS). Self-edges are skipped
 * and edges pointing outside the graph are ignored. Node order among
 * independent nodes follows the map's insertion order.
 *
 * @param graph - Node key to its dependency keys.
 * @param kind - Word used in the cycle error (e.g. 'foreign-key', 'module').
 * @returns Keys sorted dependencies-first.
 * @throws {Error} On a cycle, with the cycle path in the message.
 */
export function topoSort(
  graph: Map<string, Iterable<string>>,
  kind: string
): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new Error(
        `Cyclic ${kind} dependency detected: ${[...visiting, key].join(' -> ')}`
      );
    }
    visiting.add(key);
    for (const dep of graph.get(key) ?? []) {
      if (dep === key) continue; // self-reference (e.g. parent_id) is fine
      if (!graph.has(dep)) continue; // external target — not ours to order
      visit(dep);
    }
    visiting.delete(key);
    visited.add(key);
    sorted.push(key);
  };

  for (const key of graph.keys()) visit(key);
  return sorted;
}

/**
 * Orders model instances parent-first by their FK references.
 * Models must already be bound to their effective schema (via forSchema),
 * since graph keys derive from `schema.dbSchema`.
 *
 * @param models - Map of model instances (any keys; non-table values are
 *   filtered out).
 * @returns Instances ordered so referenced tables come first.
 * @throws {Error} On a cyclic FK dependency.
 */
export function orderModels<T>(models: Record<string, T>): T[] {
  const byKey = new Map<string, T>();
  for (const value of Object.values(models)) {
    if (isTableModel(value)) byKey.set(getModelKey(value), value);
  }
  const graph = new Map<string, Iterable<string>>();
  for (const [key, model] of byKey) {
    graph.set(key, getTableDependencies(model as TableModelLike));
  }
  return topoSort(graph, 'foreign-key').map(key => byKey.get(key) as T);
}

/**
 * Resolves the execution order of registry modules: if a model in module A
 * references a table owned by module B, B runs first. Order among
 * independent modules follows the caller's array order.
 *
 * @param modules - Registry module descriptors.
 * @param schema - Target Postgres schema models are bound to.
 * @param db - Executor used to construct model instances.
 * @param pgp - pg-promise root library instance.
 * @param logger - Optional logger passed to model constructors.
 * @returns Module names in execution order.
 * @throws {Error} On duplicate module names or a cyclic module dependency.
 */
export function resolveModuleOrder(
  modules: ModuleDescriptor[],
  schema: string,
  db: DbConnection,
  pgp: IMain,
  logger: Logger | null = null
): string[] {
  const tableToModule = new Map<string, string>();
  const instancesByModule = new Map<string, TableModelLike[]>();

  for (const moduleDef of modules) {
    if (instancesByModule.has(moduleDef.name)) {
      throw new Error(
        `Duplicate module name "${moduleDef.name}" in migration registry`
      );
    }
    const instances: TableModelLike[] = [];
    for (const Ctor of Object.values(moduleDef.models ?? {})) {
      const instance = instantiateBound(Ctor, schema, db, pgp, logger);
      if (isTableModel(instance)) {
        instances.push(instance);
        tableToModule.set(getModelKey(instance), moduleDef.name);
      }
    }
    instancesByModule.set(moduleDef.name, instances);
  }

  const graph = new Map<string, Iterable<string>>();
  for (const [moduleName, instances] of instancesByModule) {
    const deps = new Set<string>();
    for (const instance of instances) {
      for (const dep of getTableDependencies(instance)) {
        const owner = tableToModule.get(dep);
        if (owner && owner !== moduleName) deps.add(owner);
      }
    }
    graph.set(moduleName, deps);
  }

  return topoSort(graph, 'module');
}

/**
 * Constructs a repository on the given executor and binds it to the target
 * schema when it supports forSchema().
 *
 * @param Ctor - Repository constructor.
 * @param schema - Target Postgres schema.
 * @param db - Executor passed to the constructor.
 * @param pgp - pg-promise root library instance.
 * @param logger - Optional logger.
 * @returns The (possibly rebound) instance.
 */
export function instantiateBound(
  Ctor: RepositoryCtor,
  schema: string,
  db: DbConnection,
  pgp: IMain,
  logger: Logger | null = null
): unknown {
  const instance = new Ctor(db, pgp, logger);
  const bindable = instance as Partial<SchemaBindable>;
  if (typeof bindable.forSchema === 'function') {
    return bindable.forSchema(schema);
  }
  return instance;
}
