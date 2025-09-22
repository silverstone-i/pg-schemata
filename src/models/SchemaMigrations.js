'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

// src/models/SchemaMigrations.js
//
// SchemaMigrations model and schema definition
//
// This module defines a TableModel subclass for recording applied database
// migrations. It uses the same schema-driven approach as other models in
// pg‑schemata. When used together with the MigrationManager (see
// `src/migrate/MigrationManager.js`), it enables versioned schema changes
// without relying on an external migration library.

import { TableModel } from '../TableModel.js';

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
  version: '1.0.0',
  columns: [
    {
      name: 'schema_name',
      type: 'text',
      nullable: false,
    },
    {
      name: 'version',
      type: 'integer',
      nullable: false,
    },
    {
      name: 'hash',
      type: 'text',
      nullable: false,
    },
    {
      name: 'label',
      type: 'text',
      nullable: true,
    },
    {
      name: 'applied_at',
      type: 'timestamptz',
      default: 'now()',
      nullable: false,
    },
  ],
  constraints: {
    // Composite primary key on (schema_name, version) ensures that
    // each migration is uniquely identified per schema.
    primaryKey: ['schema_name', 'version'],
    // Index for quick lookups by schema and version. The type property is
    // required by pg‑schemata to distinguish between different index types.
    indexes: [
      {
        type: 'Index',
        columns: ['schema_name', 'version'],
      },
    ],
  },
};

/**
 * TableModel subclass for the `schema_migrations` table.
 *
 * This class simply passes the `migrationSchema` to the base TableModel
 * constructor. It relies on the pg‑schemata TableModel to generate
 * ColumnSets, validators and CRUD helpers based on the schema definition.
 */
export class SchemaMigrations extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, migrationSchema, logger);
  }
}