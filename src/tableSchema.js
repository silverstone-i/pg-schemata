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
 * @typedef ColumnDefinition
 * @property {string} name - The name of the column.
 * @property {string} type - PostgreSQL data type (e.g., 'text', 'uuid', 'integer').
 * @property {number} [length] - Optional length for types like `varchar`.
 * @property {boolean} [nullable] - Whether the column accepts null values. Defaults to true.
 * @property {*} [default] - Default value for the column. Can be a literal or SQL expression.
 * @property {boolean} [immutable] - If true, the column cannot be updated after initial creation. Defaults to false.
 */

/**
 * @typedef ConstraintDefinition
 * @property {string} type - Type of constraint (e.g., 'PrimaryKey', 'ForeignKey', 'Unique', 'Check', 'Index').
 * @property {Array<string>} columns - List of column names the constraint applies to.
 * @property {string} [references] - Referenced table and column for foreign keys (e.g., 'public.users(id)').
 * @property {string} [onDelete] - Delete action for foreign keys (e.g., 'CASCADE', 'SET NULL').
 * @property {string} [expression] - SQL expression for check constraints.
 */

/**
 * @typedef Constraints
 * @property {Array<string>} [primaryKey] - Columns that make up the primary key.
 * @property {Array<Array<string>>} [unique] - Array of unique column sets.
 * @property {Array<ConstraintDefinition>} [foreignKeys] - List of foreign key definitions.
 * @property {Array<ConstraintDefinition>} [checks] - List of check constraint definitions.
 * @property {Array<ConstraintDefinition>} [indexes] - List of index definitions.
 */

/**
 * @typedef TableSchema
 * @property {string} dbSchema - Name of the PostgreSQL schema (e.g., 'public').
 * @property {string} table - Table name.
 * @property {boolean} hasAuditFields - If true, audit fields will be added (`created_at`, `updated_at`, etc.).
 * @property {string} version - Semantic version of the schema definition.
 * @property {Array<ColumnDefinition>} columns - List of column definitions.
 * @property {Constraints} constraints - Table-level constraints like keys and indexes.
 */

/**
 * Example table schema definition used to generate and validate PostgreSQL DDL for BaseModel.
 * @type {TableSchema}
 */
const tableSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  version: '1.0.0',
  columns: [
    {
      name: 'id',
      type: 'uuid',
      default: 'gen_random_uuid()',
      nullable: false,
      immutable: true,
    },
    {
      name: 'tenant_id',
      type: 'uuid',
      nullable: false,
    },
    {
      name: 'email',
      type: 'varchar',
      length: 255,
      nullable: false,
    },
    {
      name: 'password_hash',
      type: 'text',
      nullable: false,
    },
    {
      name: 'first_name',
      type: 'varchar',
      length: 100,
      nullable: true,
    },
    {
      name: 'last_name',
      type: 'varchar',
      length: 100,
      nullable: true,
    },
    {
      name: 'is_active',
      type: 'boolean',
      default: 'true',
      nullable: false,
    },
    {
      name: 'role',
      type: 'varchar',
      length: 50,
      default: `'user'`,
      nullable: false,
    }
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [
      ['tenant_id', 'email']
    ],
    foreignKeys: [
      {
        type: 'ForeignKey',
        columns: ['tenant_id'],
        references: 'admin.tenants(id)',
        onDelete: 'CASCADE'
      }
    ],
    checks: [
      {
        type: 'Check',
        expression: `char_length(email) > 3`
      },
      {
        type: 'Check',
        expression: `role IN ('user', 'admin', 'moderator')`
      }
    ],
    indexes: [
      {
        type: 'Index',
        columns: ['email']
      },
      {
        type: 'Index',
        columns: ['tenant_id', 'role']
      }
    ]
  }
};