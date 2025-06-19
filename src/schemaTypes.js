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
 * Function to conditionally skip this column in update.
 * @callback SkipFunction
 * 
 * @param {*} col - Column value being inserted or updated
 * @returns {boolean} True to skip this column
 */

/**
 * Function to initialize the value dynamically.
 * @callback InitFunction
 * 
 * @param {Object} dto - Data transfer object being processed
 * @returns {*} Initialized value for the column
 */

/**
 * pg-promise column helper modifiers.
 * @typedef {Object} ColumnProps
 * 
 * @property {string} [mod] - Format modifier.
 * @property {SkipFunction} [skip] - Conditionally skip this column in update.
 * @property {boolean} [cnd] - Use in conditional update clause.
 * @property {InitFunction} [init] - Initialize the value dynamically.
 * @property {string} [def] - Override default value.
 */

/**
 * Defines the structure of a single column in a table schema.
 * @typedef {Object} ColumnDefinition
 * 
 * @property {string} name - The name of the column.
 * @property {string} type - PostgreSQL data type (e.g., 'text', 'uuid', 'integer', 'varchar', 'jsonb').
 * @property {boolean} [nullable] - Whether the column accepts null values. Defaults to true.
 * @property {*} [default] - Default value for the column. Can be a literal or SQL expression.
 * @property {boolean} [immutable] - If true, the column cannot be updated after creation. Defaults to false.
 * @property {ColumnProps} [colProps] - pg-promise column helper modifiers.
 */

/**
 * Represents a schema-level constraint such as primary key or foreign key.
 * @typedef {Object} ConstraintDefinition
 *
 * @property {'PrimaryKey'|'ForeignKey'|'Unique'|'Check'|'Index'} type - Type of constraint.
 * @property {Array<string>} columns - List of column names the constraint applies to.
 * @property {{ table: string, columns: Array<string> }} [references] - For foreign keys.
 * @property {string} [onDelete] - Optional ON DELETE behavior (e.g., 'CASCADE').
 * @property {string} [expression] - SQL expression for check constraints.
 */

/**
 * Container for all structural and relational constraints applied to a table.
 * @typedef {Object} Constraints
 *
 * @property {Array<string>} [primaryKey] - Column names used as the primary key.
 * @property {Array<Array<string>>} [unique] - List of unique constraints (single or composite).
 * @property {Array<ConstraintDefinition>} [foreignKeys] - Array of foreign key definitions.
 * @property {Array<ConstraintDefinition>} [checks] - Array of SQL check expressions.
 * @property {Array<ConstraintDefinition>} [indexes] - Index definitions for query optimization.
 */

/**
 * Describes the full definition of a table schema for pg-schemata.
 * @typedef {Object} TableSchema
 *
 * @property {string} dbSchema - PostgreSQL schema name (e.g., 'public').
 * @property {string} table - Table name.
 * @property {boolean} [hasAuditFields] - Whether to include created_at/updated_at/by fields.
 * @property {string} [version] - Optional schema version string.
 * @property {Array<ColumnDefinition>} columns - List of column definitions.
 * @property {Constraints} [constraints] - Table-level constraints.
 */
