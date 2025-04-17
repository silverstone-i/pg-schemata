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
 * @typedef {Object} ColumnDefinition
 * @property {string} name - The name of the column.
 * @property {string} type - PostgreSQL data type (e.g., 'text', 'uuid', 'integer').
 * @property {number} [length] - Optional length for types like `varchar`.
 * @property {boolean} [nullable=true] - Whether the column accepts null values.
 * @property {*} [default] - Default value for the column. Can be a literal or SQL expression.
 * @property {boolean} [immutable=false] - If true, the column cannot be updated after initial creation.
 */

/**
 * @typedef {Object} ConstraintDefinition
 * @property {string} type - Type of constraint (e.g., 'PrimaryKey', 'ForeignKey', 'Unique', 'Check', 'Index').
 * @property {string[]} columns - Array of column names the constraint applies to.
 * @property {string} [references] - For foreign keys: referenced table and column (e.g., 'public.users(id)').
 * @property {string} [onDelete] - For foreign keys: delete action (e.g., 'CASCADE', 'SET NULL').
 * @property {string} [expression] - For check constraints: SQL expression to evaluate.
 */

/**
 * @typedef {Object} Constraints
 * @property {string[]} [primaryKey] - Columns that make up the primary key.
 * @property {string[][]} [unique] - Array of unique column sets. Each set may contain multiple column names.
 * @property {ConstraintDefinition[]} [foreignKeys] - List of foreign key definitions.
 * @property {ConstraintDefinition[]} [checks] - List of check constraint definitions.
 * @property {ConstraintDefinition[]} [indexes] - List of index definitions.
 */

/**
 * @typedef {Object} TableSchema
 * @property {string} dbSchema - PostgreSQL schema name (e.g., 'public').
 * @property {string} table - Table name.
 * @property {boolean} hasAuditFields - If true, BaseModel adds audit fields (`created_at`, `updated_at`, `created_by`, `updated_by`).
 * @property {string} version - Semantic version of the schema definition.
 * @property {ColumnDefinition[]} columns - List of column definitions.
 * @property {Constraints} constraints - Constraints applied to the table (e.g., primary keys, foreign keys, indexes).
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