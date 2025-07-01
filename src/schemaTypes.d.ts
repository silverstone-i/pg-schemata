/**
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

/**
 * @typedef {Object} ColumnDefinition
 * Defines the structure of a single column in a table schema.
 *
 * @property {string} name - The name of the column.
 * @property {string} type - PostgreSQL data type (e.g., 'text', 'uuid', 'integer', 'varchar', 'jsonb').
 * @property {'always'|'by default'} [generated] - Marks the column as a generated column.
 * @property {string} [expression] - SQL expression used for the generated column.
 * @property {boolean} [stored] - Whether the generated column should be stored.
 * @property {boolean} [nullable] - Whether the column accepts null values. Defaults to true.
 * @property {*} [default] - Default value for the column. Can be a literal or SQL expression.
 * @property {boolean} [immutable] - If true, the column cannot be updated after creation. Defaults to false.
 * @property {Object} [colProps] - pg-promise column helper modifiers.
 * @property {string} [colProps.mod] - Format modifier.
 * @property {(col: any) => boolean} [colProps.skip] - Conditionally skip this column in insert/update.
 * @property {boolean} [colProps.cnd] - Use in conditional update clause.
 * @property {(dto: any) => any} [colProps.init] - Function to initialize the value dynamically.
 * @property {string} [colProps.def] - Override default value.
 */
export interface ColumnDefinition {
  name: string;
  type: string;
  generated?: 'always' | 'by default';  
  expression?: string;                  
  stored?: boolean;                     
  nullable?: boolean;
  default?: any;
  immutable?: boolean;
  colProps?: {
    mod?: string;
    skip?: (col: any) => boolean;
    cnd?: boolean;
    init?: (dto: any) => any;
    def?: string;
  };
}

/**
 * @typedef {Object} ConstraintDefinition
 * Represents a schema-level constraint such as primary key or foreign key.
 *
 * @property {'PrimaryKey'|'ForeignKey'|'Unique'|'Check'|'Index'} type - Type of constraint.
 * @property {Array<string>} columns - List of column names the constraint applies to.
 * @property {{ table: string, columns: Array<string> }} [references] - For foreign keys.
 * @property {string} [onDelete] - Optional ON DELETE behavior (e.g., 'CASCADE').
 * @property {string} [expression] - SQL expression for check constraints.
 */
export interface ConstraintDefinition {
  type: 'PrimaryKey' | 'ForeignKey' | 'Unique' | 'Check' | 'Index';
  columns: string[];
  references?: {
    table: string;
    columns: string[];
  };
  onDelete?: string;
  expression?: string;
}

/**
 * @typedef {Object} Constraints
 * Container for all structural and relational constraints applied to a table.
 *
 * @property {Array<string>} [primaryKey] - Column names used as the primary key.
 * @property {Array<Array<string>>} [unique] - List of unique constraints (single or composite).
 * @property {Array<ConstraintDefinition>} [foreignKeys] - Array of foreign key definitions.
 * @property {Array<ConstraintDefinition>} [checks] - Array of SQL check expressions.
 * @property {Array<ConstraintDefinition>} [indexes] - Index definitions for query optimization.
 */
export interface Constraints {
  primaryKey?: string[];
  unique?: string[][];
  foreignKeys?: ConstraintDefinition[];
  checks?: ConstraintDefinition[];
  indexes?: ConstraintDefinition[];
}

/**
 * @typedef {Object} TableSchema
 * Describes the full definition of a table schema for pg-schemata.
 *
 * @property {string} dbSchema - PostgreSQL schema name (e.g., 'public').
 * @property {string} table - Table name.
 * @property {boolean} [hasAuditFields] - Whether to include created_at/updated_at/by fields.
 * @property {boolean} [softDelete] - Whether to use a soft delete strategy.
 * @property {string} [version] - Optional schema version string.
 * @property {Array<ColumnDefinition>} columns - List of column definitions.
 * @property {Constraints} [constraints] - Table-level constraints.
 */
export interface TableSchema {
  dbSchema: string;
  table: string;
  hasAuditFields?: boolean;
  softDelete?: boolean;
  version?: string;
  columns: ColumnDefinition[];
  constraints?: Constraints;
}

// Dummy export to force typedef symbols to register
export {};