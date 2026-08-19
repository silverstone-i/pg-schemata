/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import DB from '../DB.js';
import { Database } from '../Database.js';
import type { Repositories } from '../schemaTypes.js';

/**
 * Structural shape of a schema-aware model: anything exposing forSchema.
 */
export interface SchemaAwareModel {
  forSchema(schemaName: string): SchemaAwareModel;
}

/**
 * @private
 *
 * A registered repository name, when {@link Repositories} has been augmented.
 *
 * `callDb` previously carried an unconditional `(name: string)` overload, which
 * accepted any string and returned a bare {@link SchemaAwareModel} — so a typo
 * in a repository name compiled and failed at runtime, and the augmented
 * registry bought nothing at this call site. Narrowing it to `keyof
 * Repositories` once the registry is declared restores that, while leaving
 * un-augmented consumers with today's permissive `string`.
 */
type RepositoryName = keyof Repositories extends never
  ? string
  : keyof Repositories;

/**
 * Returns a schema-aware version of a registered model or repository.
 *
 * The two-argument name form resolves against the `DB` compatibility default
 * instance. Pass a {@link Database} as the third argument to resolve against
 * that instance instead — it routes through `from.forSchema()`, so the
 * instance's schema cache and closed-state guard both apply.
 *
 * @param modelOrName - The model instance or its registered name.
 * @param schemaName - The database schema to bind.
 * @param from - Optional database instance owning the named repository.
 * @returns The model bound to the given schema.
 * @throws {Error} If the model is not schema-aware.
 */
function callDb<R, K extends Extract<keyof R, string>>(
  modelOrName: K,
  schemaName: string,
  from: Database<R>
): R[K];
function callDb<K extends keyof Repositories>(
  modelOrName: K,
  schemaName: string
): Repositories[K];
function callDb<M extends SchemaAwareModel>(
  modelOrName: M,
  schemaName: string
): M;
function callDb(
  modelOrName: RepositoryName,
  schemaName: string
): SchemaAwareModel;
function callDb(
  modelOrName: string | SchemaAwareModel,
  schemaName: string,
  from?: unknown
): unknown {
  if (typeof modelOrName === 'string' && from instanceof Database) {
    // Route through the instance so its schema cache and closed-state guard
    // are honored, rather than reaching into from.db directly.
    const bound = (
      from.forSchema(schemaName) as unknown as Record<string, unknown>
    )[modelOrName];
    if (bound === undefined) {
      throw new Error(
        `callDb: no repository named "${modelOrName}" on this database instance`
      );
    }
    return bound;
  }

  const model =
    typeof modelOrName === 'string'
      ? (DB.db as unknown as Record<string, unknown>)[modelOrName]
      : modelOrName;

  if (!isSchemaAware(model)) {
    throw new Error('callDb: provided model is not schema-aware');
  }

  return model.forSchema(schemaName);
}

/** Formalizes the runtime duck-typing check for forSchema. */
function isSchemaAware(value: unknown): value is SchemaAwareModel {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { forSchema?: unknown }).forSchema === 'function'
  );
}

export { callDb };
