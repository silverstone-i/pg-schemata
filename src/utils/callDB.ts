/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import DB from '../DB.js';
import type { Repositories } from '../schemaTypes.js';

/**
 * Structural shape of a schema-aware model: anything exposing forSchema.
 */
export interface SchemaAwareModel {
  forSchema(schemaName: string): SchemaAwareModel;
}

/**
 * Returns a schema-aware version of a registered model or repository.
 *
 * @param modelOrName - The model instance or its registered name.
 * @param schemaName - The database schema to bind.
 * @returns The model bound to the given schema.
 * @throws {Error} If the model is not schema-aware.
 */
function callDb<K extends keyof Repositories>(
  modelOrName: K,
  schemaName: string
): Repositories[K];
function callDb<M extends SchemaAwareModel>(
  modelOrName: M,
  schemaName: string
): M;
function callDb(modelOrName: string, schemaName: string): SchemaAwareModel;
function callDb(
  modelOrName: string | SchemaAwareModel,
  schemaName: string
): SchemaAwareModel {
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
