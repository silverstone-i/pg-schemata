/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/models/SchemaMigrations.ts
//
// SchemaMigrations model and schema definition
//
// This module defines a TableModel subclass for recording applied database
// migrations. It uses the same schema-driven approach as other models in
// pg‑schemata. When used together with the MigrationManager (see
// `src/migrate/MigrationManager.ts`), it enables versioned schema changes
// without relying on an external migration library.

import { TableModel } from '../TableModel.js';
import type { DbConnection, Logger, TableSchema } from '../schemaTypes.js';
import type { IMain } from 'pg-promise';

/** A row of the `schema_migrations` table. */
export interface SchemaMigrationRow {
  schema_name: string;
  module_name: string;
  migration_id: string;
  hash: string;
  description: string | null;
  applied_at: Date;
}

/**
 * Schema definition for the `schema_migrations` table.
 *
 * The shape of this object follows the standard table schema format used
 * throughout pg‑schemata. Each column is defined as an object within the
 * `columns` array, and table level constraints live in the `constraints`
 * property. Audit fields (created_at, updated_at, etc.) are enabled via
 * `hasAuditFields`.
 */
export const migrationSchema = {
  dbSchema: 'public',
  table: 'schema_migrations',
  hasAuditFields: true,
  softDelete: false,
  // Optional tag describing this schema version. You can bump the version
  // whenever the schema definition itself changes (not the migration data).
  version: '2.0.0',
  columns: [
    {
      name: 'schema_name',
      type: 'text',
      notNull: true,
    },
    {
      name: 'module_name',
      type: 'text',
      notNull: true,
    },
    {
      name: 'migration_id',
      type: 'text',
      notNull: true,
    },
    {
      name: 'hash',
      type: 'text',
      notNull: true,
    },
    {
      name: 'description',
      type: 'text',
    },
    {
      name: 'applied_at',
      type: 'timestamptz',
      default: 'now()',
      notNull: true,
    },
  ],
  constraints: {
    // Composite primary key: each migration is uniquely identified per
    // schema and module.
    primaryKey: ['schema_name', 'module_name', 'migration_id'],
    indexes: [
      {
        type: 'Index',
        columns: ['schema_name', 'module_name', 'migration_id'],
      },
    ],
  },
} satisfies TableSchema;

/**
 * TableModel subclass for the `schema_migrations` table.
 *
 * This class simply passes the `migrationSchema` to the base TableModel
 * constructor. It relies on the pg‑schemata TableModel to generate
 * ColumnSets, validators and CRUD helpers based on the schema definition.
 */
export class SchemaMigrations extends TableModel<SchemaMigrationRow> {
  constructor(db: DbConnection, pgp: IMain, logger: Logger | null = null) {
    super(db, pgp, migrationSchema, logger);
  }
}
