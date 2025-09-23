'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

/**
 * @private
 *
 * Example table schema demonstrating all supported features in pg-schemata.
 *
 * Top-level properties:
 * - `dbSchema`: PostgreSQL schema name
 * - `table`: name of the table
 * - `hasAuditFields`: if true, adds created_at/updated_at/by fields automatically
 * - `softDelete`: if true, adds an deleted_at field for soft deletes
 * - `version`: optional version tag for tracking schema evolution
 *
 * ## 📌 Columns
 * Each column is defined with:
 * - `name` (string): column name
 * - `type` (string): PostgreSQL data type (e.g. 'uuid', 'varchar(255)', 'jsonb')
 * - `nullable` (boolean): whether NULL is allowed
 * - `default` (string): default SQL expression
 * - `immutable` (boolean): if true, excluded from updates
 * - `colProps` (object): pg-promise column options such as `mod`, `skip`, `cnd`, etc.
 *
 * For `colProps` documentation, see: https://vitaly-t.github.io/pg-promise/helpers.Column.html
 *
 * ## 🔐 Constraints
 * - `primaryKey`: array of column names
 * - `unique`: array of unique constraint definitions (arrays of column names)
 * - `foreignKeys[]`: each with `columns`, `references.table`, `references.column`, and `onDelete`
 * - `checks[]`: SQL expressions enforcing conditions
 * - `indexes[]`: regular indexes on one or more columns
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
      nullable: false,
      immutable: true,
      colProps: { cnd: true },
    },
    {
      name: 'tenant_id',
      type: 'uuid',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'password_hash',
      type: 'text',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'first_name',
      type: 'varchar(100)',
      nullable: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'last_name',
      type: 'varchar(100)',
      nullable: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'address',
      type: 'jsonb',
      nullable: true,
      colProps: { mod: ':json', skip: c => !c.exists },
    },
    {
      name: 'is_active',
      type: 'boolean',
      default: 'true',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'role',
      type: 'varchar(50)',
      default: `'user'`,
      nullable: false,
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
          table: 'admin.tenants(id)',
          column: ['id'],
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
};

export default tableSchema;
