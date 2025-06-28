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
 * @fileoverview
 * @private
 *
 * Utility functions for generating SQL statements and pg-promise ColumnSets
 * based on a structured schema definition.
 */

import SchemaDefinitionError from '../SchemaDefinitionError.js';
import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import { logMessage } from './pg-util.js';

const columnSetCache = new LRUCache({ max: 20000, ttl: 1000 * 60 * 60 });
// Cache for storing generated ColumnSets to avoid redundant computations
// and improve performance
/**
 * Creates a short MD5-based hash of the input string.
 *
 * @param {string} input - Value to hash.
 * @returns {string} A 6-character hex hash.
 */
function createHash(input) {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 6);
}

/**
 * @private
 *
 * Generates a CREATE TABLE SQL statement based on a validated table schema definition.
 *
 * @param {TableSchema} schema - Structured schema definition.
 * @param {Object|null} logger - Optional logger instance.
 * @returns {string} SQL statement for creating the table.
 * @throws {SchemaDefinitionError} If a foreign key reference is invalid.
 */
function createTableSQL(schema, logger = null) {
  // Extract schema components: schema name, table name, columns, and constraints
  const { dbSchema, table, columns, constraints = {} } = schema;
  const schemaName = dbSchema || 'public';

  // Build column definitions with types, NOT NULL, and DEFAULT clauses
  const columnDefs = columns.map(col => {
    let def = `"${col.name}" ${col.type}`;
    if (col.notNull) def += ' NOT NULL';
    if (col.default !== undefined) {
      let defaultValue = col.default;
      if (typeof defaultValue === 'string') {
        const builtins = new Set(['now', 'current_timestamp']);

        defaultValue = defaultValue.replace(/\b([a-z_][a-z0-9_]*)\s*\(\)/gi, (match, fnName) => {
          if (builtins.has(fnName.toLowerCase()) || /\b\w+\.\w+\(\)/.test(match)) {
            return match;
          }
          return `public.${fnName}()`;
        });
      }
      def += ` DEFAULT ${defaultValue}`;
    }
    return def;
  });

  // Initialize list to hold table-level constraints
  const tableConstraints = [];

  // Handle PRIMARY KEY constraint
  // Primary Key
  if (constraints.primaryKey) {
    tableConstraints.push(`PRIMARY KEY (${constraints.primaryKey.map(c => `"${c}"`).join(', ')})`);
  }

  // Handle UNIQUE constraints with generated names
  // Unique Constraints
  if (constraints.unique) {
    for (const uniqueCols of constraints.unique) {
      const hash = createHash(table + uniqueCols.join('_'));
      const constraintName = `uidx_${table}_${uniqueCols.join('_')}_${hash}`;
      tableConstraints.push(`CONSTRAINT "${constraintName}" UNIQUE (${uniqueCols.map(c => `"${c}"`).join(', ')})`);
    }
  }

  // Handle FOREIGN KEY constraints with ON DELETE/UPDATE rules
  // Foreign Keys
  if (constraints.foreignKeys) {
    for (const fk of constraints.foreignKeys) {
      if (typeof fk.references !== 'object') {
        throw new SchemaDefinitionError(
          `Invalid foreign key reference for table ${table}: expected object, got ${typeof fk.references}`
        );
      }

      const hash = createHash(table + fk.references.table + fk.columns.join('_'));
      const constraintName = `fk_${table}_${hash}`;

      {
        const hash = createHash(table + fk.references.table + fk.columns.join('_'));
        const constraintName = `fk_${table}_${hash}`;

        const [refSchema, refTable] = fk.references.table.includes('.')
          ? fk.references.table.split('.')
          : [schemaName, fk.references.table];

        tableConstraints.push(
          `CONSTRAINT "${constraintName}" FOREIGN KEY (${fk.columns.map(c => `"${c}"`).join(', ')}) ` +
            `REFERENCES "${refSchema}"."${refTable}" (${fk.references.columns.map(c => `"${c}"`).join(', ')})` +
            (fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '') +
            (fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '')
        );
      }
    }
  }

  // Handle CHECK constraints
  // Check Constraints
  if (constraints.checks) {
    for (const check of constraints.checks) {
      tableConstraints.push(`CHECK (${check.expression})`);
    }
  }

  // Combine column definitions and constraints into final CREATE TABLE statement
  const allDefs = columnDefs.concat(tableConstraints).join(',\n  ');

  const sql = `CREATE SCHEMA IF NOT EXISTS "${schemaName}";
  CREATE TABLE IF NOT EXISTS "${schemaName}"."${table}" (
    ${allDefs}
  );
  `.trim();

  logMessage({
    logger,
    level: 'debug',
    schema: schemaName,
    table,
    message: 'Generated CREATE TABLE SQL',
    data: { sql },
  });

  // if (table === 'costlines') {
  //   console.log('costlines sql', sql);
  // }

  return sql;
}

/**
 * @private
 *
 * Appends standard audit fields to a table schema's column list if not already present.
 *
 * @param {TableSchema} schema - The table schema to modify.
 * @returns {TableSchema} The updated schema with audit fields.
 */
function addAuditFields(schema) {
  const { columns } = schema;
  if (schema?.hasAuditFields) {
    const auditFields = [
      {
        name: 'created_at',
        type: 'timestamptz',
        default: 'now()',
        immutable: true,
      },
      {
        name: 'created_by',
        type: 'varchar(50)',
        default: `'system'`,
        immutable: true,
      },
      { name: 'updated_at', type: 'timestamptz', default: 'now()' },
      { name: 'updated_by', type: 'varchar(50)', default: `'system'` },
    ];

    for (const auditField of auditFields) {
      if (!columns.find(col => col.name === auditField.name)) {
        columns.push(auditField);
      }
    }
  }

  if (schema?.softDelete) {
    const hasDeactivatedAt = columns.some(col => col.name === 'deactivated_at');
    if (!hasDeactivatedAt) {
      columns.push({
        name: 'deactivated_at',
        type: 'timestamptz',
        nullable: true,
      });
    }
  }

  return schema;
}

/**
 * @private
 *
 * Generates CREATE INDEX SQL statements based on declared index constraints.
 *
 * @param {TableSchema} schema - Structured schema object.
 * @param {boolean} [unique=false] - Whether to treat all indexes as unique.
 * @param {string|null} [where=null] - Optional WHERE clause for partial indexes.
 * @param {Object|null} logger - Optional logger instance.
 * @returns {string} One or more SQL CREATE INDEX statements.
 * @throws {SchemaDefinitionError} If no indexes are defined in the schema.
 */
function createIndexesSQL(schema, unique = false, where = null, logger = null) {
  // Ensure that index definitions are present in the schema
  if (!schema.constraints || !schema.constraints.indexes) {
    throw new SchemaDefinitionError('No indexes defined in schema');
  }

  const { indexes } = schema.constraints;

  const indexSQL = indexes.map(index => {
    const indexName = `${unique ? 'uidx' : 'idx'}_${schema.table}_${index.columns.join('_')}`.toLowerCase();
    return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${schema.schemaName}"."${schema.table}" (${index.columns.join(
      ', '
    )});`;
  });

  logMessage({
    logger,
    level: 'debug',
    schema: schema.schemaName,
    table: schema.table,
    message: 'Generated INDEX SQL',
    data: { sql: indexSQL.join('\n') },
  });

  return indexSQL.join('\n');
}

/**
 * @private
 *
 * Cleans SQL strings by collapsing whitespace and removing trailing semicolons.
 *
 * @param {string} sql - Raw SQL string.
 * @returns {string} Normalized SQL.
 */
function normalizeSQL(sql) {
  return sql.replace(/\s+/g, ' ').replace(/;$/, '').trim();
}

/**
 * @private
 *
 * Generates pg-promise ColumnSet definitions for insert and update operations.
 *
 * @param {TableSchema} schema - Parsed table schema.
 * @param {Object} pgp - pg-promise instance.
 * @param {Object|null} logger - Optional logger instance.
 * @returns {Object} A ColumnSet object with insert/update variants.
 * @throws {SchemaDefinitionError} If audit field state or colProps are invalid.
 */
function createColumnSet(schema, pgp, logger = null) {
  // Check if the schema is already cached
  const cacheKey = `${schema.table}::${schema.dbSchema}`;
  if (columnSetCache.has(cacheKey)) {
    return columnSetCache.get(cacheKey);
  }
  validateColumnProps(schema.columns);

  // Define standard audit field names to exclude from base ColumnSet
  const auditFields = ['created_at', 'created_by', 'updated_at', 'updated_by'];
  // Remove audit fields from the list of columns
  const columnsetColumns = schema.columns.filter(col => !auditFields.includes(col.name));

  const hasAuditFields = columnsetColumns.length !== schema.columns.length;

  // Validate that audit fields hav been added correctly
  if (schema.hasOwnProperty('hasAuditFields') && hasAuditFields !== schema.hasAuditFields) {
    const message = hasAuditFields
      ? 'Cannot use create_at, created_by, updated_at, updated_by in your schema definition'
      : 'Audit fields have been removed from the schema. Set schema.hasAuditFields = false to avoid this error';
    throw new SchemaDefinitionError(message);
  }

  // Transform schema columns into ColumnSet configurations
  const columns = columnsetColumns
    .map(col => {
      const isPrimaryKey = schema.constraints?.primaryKey?.includes(col.name);
      const hasDefault = col.hasOwnProperty('default');

      // Skip serial or UUID primary keys with defaults
      if (col.type === 'serial' || (col.type === 'uuid' && isPrimaryKey && hasDefault)) {
        return null;
      }

      const columnObject = {
        name: col.name,
        ...(col.colProps || {}),
        def: col.hasOwnProperty('default') ? col.default : col.colProps?.def ?? undefined,
      };

      return columnObject;
    })
    .filter(col => col !== null); // Remove nulls (skipped columns)
  /**
   * @private
   *
   * Validates column definitions to ensure colProps.skip is a function if provided.
   *
   * @param {Array<ColumnDefinition>} columns - Array of column definitions.
   * @throws {SchemaDefinitionError} If colProps.skip is invalid.
   */
  function validateColumnProps(columns) {
    for (const col of columns) {
      if (col.colProps) {
        const { skip } = col.colProps;
        if (typeof skip !== 'undefined' && typeof skip !== 'function') {
          throw new SchemaDefinitionError(
            `Invalid colProps.skip for column "${col.name}": expected function, got ${typeof skip}`
          );
        }
      }
    }
  }

  const cs = {};

  // Instantiate ColumnSet for base table operations
  cs[schema.table] = new pgp.helpers.ColumnSet(columns, {
    table: {
      table: schema.table,
      schema: schema.dbSchema || 'public',
    },
  });

  // Create separate ColumnSet variants for insert and update to include audit fields
  if (hasAuditFields) {
    cs.insert = cs[schema.table].extend(['created_by']);
    cs.update = cs[schema.table].extend([
      {
        name: 'updated_at',
        mod: '^',
        def: 'CURRENT_TIMESTAMP',
      },
      'updated_by',
    ]);
  } else {
    cs.insert = cs[schema.table];
    cs.update = cs[schema.table];
  }

  logMessage({
    logger,
    level: 'debug',
    schema: schema.dbSchema,
    table: schema.table,
    message: 'Created ColumnSet',
    data: { columns: columns.map(c => c.name) },
  });

  columnSetCache.set(cacheKey, cs);

  return cs;
}

export { createTableSQL, addAuditFields, createIndexesSQL, normalizeSQL, createColumnSet, columnSetCache };
