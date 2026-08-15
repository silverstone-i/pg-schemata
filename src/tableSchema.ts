/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import type { TableSchema } from './schemaTypes.js';

/**
 * @private
 *
 * Example table schema demonstrating all supported features in pg-schemata.
 *
 * Top-level properties:
 * - `dbSchema`: PostgreSQL schema name
 * - `table`: name of the table
 * - `hasAuditFields`: if true, adds created_at/updated_at/by fields automatically
 * - `softDelete`: if true, adds a `deactivated_at` field for soft deletes
 * - `version`: optional version tag for tracking schema evolution
 *
 * ## 📌 Columns
 * Each column is defined with:
 * - `name` (string): column name
 * - `type` (string): PostgreSQL data type (e.g. 'uuid', 'varchar(255)', 'jsonb',
 *   'text[]'). The mapped set is closed — an unmapped type throws
 *   `SchemaDefinitionError` at model construction. Arrays are supported one
 *   dimension deep. See docs/guide/validation.md for the full table.
 * - `notNull` (boolean): adds NOT NULL to the column DDL
 * - `default` (string): default SQL expression
 * - `immutable` (boolean): if true, excluded from updates
 * - `colProps` (object): pg-promise column options — `mod`, `cast`, `skip`,
 *   `cnd`, `init`, `def` — plus pg-schemata's own `validator`
 *
 * For `colProps` documentation, see: https://vitaly-t.github.io/pg-promise/helpers.Column.html
 *
 * ## 🔐 Constraints
 * - `primaryKey`: array of column names
 * - `unique`: array of unique constraints, each either an array of column names
 *   or `{ columns, nullsNotDistinct?, name? }`
 * - `foreignKeys[]`: each with `columns`, `references.table`, `references.columns`, and `onDelete`
 * - `checks[]`: SQL expressions enforcing conditions
 * - `indexes[]`: index definitions supporting `unique`, `where`, `using`, `with`,
 *   and `tablespace`. Must live under `constraints` — a top-level `indexes`
 *   property throws at model construction
 */
const tableSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  softDelete: true,
  version: '1.0.0',
  columns: [
    {
      name: 'id',
      type: 'uuid',
      default: 'gen_random_uuid()',
      notNull: true,
      immutable: true,
      colProps: { cnd: true },
    },
    {
      name: 'tenant_id',
      type: 'uuid',
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'email',
      type: 'varchar(255)',
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'password_hash',
      type: 'text',
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'first_name',
      type: 'varchar(100)',
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'last_name',
      type: 'varchar(100)',
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'address',
      type: 'jsonb',
      colProps: { mod: ':json', skip: c => !c.exists },
    },
    {
      name: 'is_active',
      type: 'boolean',
      default: 'true',
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'role',
      type: 'varchar(50)',
      default: `'user'`,
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['tenant_id', 'email']],
    foreignKeys: [
      {
        type: 'ForeignKey',
        columns: ['tenant_id'],
        references: {
          table: 'admin.tenants',
          columns: ['id'],
        },
        onDelete: 'CASCADE',
      },
    ],
    checks: [
      {
        type: 'Check',
        expression: `char_length(email) > 3`,
      },
      {
        type: 'Check',
        expression: `role IN ('user', 'admin', 'moderator')`,
      },
    ],
    indexes: [
      {
        type: 'Index',
        columns: ['email'],
      },
      {
        type: 'Index',
        columns: ['tenant_id', 'role'],
      },
    ],
  },
} satisfies TableSchema;

export default tableSchema;
