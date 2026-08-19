/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/migrate/bootstrap.ts
//
// Utility to create all defined tables on first run.
//
// The `bootstrap` function is a convenience wrapper that walks through
// your repository map (as passed to `DB.init()`) and calls the
// `createTable()` method on each TableModel subclass. It can also enable
// PostgreSQL extensions, but enables none by default: `gen_random_uuid()`
// has been part of core Postgres since 13, so UUID defaults need no extension.
//
// It should be executed before any migrations if your database does not yet
// have the required tables. Use it from within a migration or during initial setup.

import { DB } from '../DB.js';
import { stampAuditResolver } from '../auditScope.js';
import { isTableModel, orderModels } from './modelPlanner.js';
import type {
  AuditActorResolver,
  DbConnection,
  RepositoryCtor,
} from '../schemaTypes.js';
import type { IMain } from 'pg-promise';

/** Options accepted by {@link bootstrap}. */
export interface BootstrapOptions {
  /** Map of repository names to their constructors. */
  models: Record<string, RepositoryCtor>;
  /** Target Postgres schema. Defaults to 'public'. */
  schema?: string;
  /** PostgreSQL extensions to enable before creating tables. Defaults to none. */
  extensions?: string[];
  /** Optional pg-promise transaction/connection to use (avoids nested transaction deadlock). */
  db?: DbConnection | null;
  /**
   * Database whose pool opens the transaction when no `db` executor is given.
   * Defaults to the `DB` compatibility singleton. `Database.bootstrap()`
   * always supplies its own.
   */
  owner?: DbConnection | null;
  /**
   * pg-promise root used to construct models. Defaults to the `DB`
   * compatibility singleton's root.
   */
  pgp?: IMain | null;
  /**
   * Audit actor resolver stamped onto every model created here, so bootstrap
   * runs with the owning database's actor rather than the global one.
   */
  auditActorResolver?: AuditActorResolver | null;
}

/**
 * Structural shape of a bootstrappable model instance: forSchema and
 * createTable are duck-typed exactly as the untyped code did.
 */
interface BootstrapModel {
  forSchema?(schemaName: string): BootstrapModel;
  createTable?(): Promise<unknown>;
}

/**
 * Create all tables defined by the provided models. This runs inside a
 * single transaction to ensure that either all tables are created or
 * none are if an error occurs.
 */
export async function bootstrap({
  models,
  schema = 'public',
  extensions = [],
  db = null,
  owner = null,
  pgp = null,
  auditActorResolver = null,
}: BootstrapOptions): Promise<void> {
  if (!models || typeof models !== 'object') {
    throw new TypeError(
      'models option must be an object mapping names to Model classes'
    );
  }

  // Resolved once, with the same explicit failure as the transaction owner
  // below: passing an undefined root into model constructors surfaces as a
  // missing-parameter error that says nothing about the real cause.
  function resolvePgp(): IMain {
    const root = pgp ?? (DB.pgp as IMain | undefined);
    if (!root) {
      throw new Error(
        'bootstrap has no pg-promise instance: pass `pgp` (or use Database.bootstrap()), or call DB.init() first'
      );
    }
    return root;
  }

  async function doBootstrap(t: DbConnection): Promise<void> {
    // Enable PostgreSQL extensions if specified
    if (extensions && Array.isArray(extensions)) {
      for (const extension of extensions) {
        await t.none('CREATE EXTENSION IF NOT EXISTS $1:name', extension);
      }
    }

    // Instantiate and schema-bind every model, then create tables in
    // FK-dependency order (parents before children) rather than insertion
    // order.
    const instances: Record<string, BootstrapModel> = {};
    for (const [name, ModelClass] of Object.entries(models)) {
      // Skip values that are not classes
      if (typeof ModelClass !== 'function') continue;
      let instance = new ModelClass(t, resolvePgp()) as BootstrapModel;
      // Stamped before schema binding so the bound clone inherits it.
      stampAuditResolver(instance, auditActorResolver);
      if (schema && typeof instance.forSchema === 'function') {
        instance = instance.forSchema(schema);
      }
      instances[name] = instance;
    }
    for (const model of orderModels(instances)) {
      await model.createTable?.();
    }
    // Preserve the historical duck-typing: values lacking the table-model
    // shape but still exposing createTable are created after the sorted set.
    for (const instance of Object.values(instances)) {
      if (
        !isTableModel(instance) &&
        typeof instance.createTable === 'function'
      ) {
        await instance.createTable();
      }
    }
  }

  // Use provided transaction, otherwise open one on the owning database.
  if (db) {
    await doBootstrap(db);
  } else {
    const fallback: DbConnection | undefined = DB.db;
    const pool = owner ?? fallback;
    if (!pool) {
      throw new Error(
        'bootstrap has no database: pass `db` or `owner` (or use Database.bootstrap()), or call DB.init() first'
      );
    }
    await pool.tx(doBootstrap);
  }
}
