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
 * Resolves index definitions from either the legacy top-level `indexes`
 * property or the newer `constraints.indexes` location.
 *
 * @param {TableSchema} schema - Structured schema definition.
 * @returns {Array|undefined} Array of index definitions if present.
 */
function resolveIndexes(schema) {
  const constraintIndexes = schema?.constraints?.indexes;
  if (Array.isArray(constraintIndexes) && constraintIndexes.length > 0) {
    return constraintIndexes;
  }

  const topLevelIndexes = schema?.indexes;
  if (Array.isArray(topLevelIndexes) && topLevelIndexes.length > 0) {
    return topLevelIndexes;
  }

  return undefined;
}

/**
 * @private
 *
 * Generates a CREATE TABLE SQL statement based on a validated table schema definition.
 *
 * @param {TableSchema} schema - Structured schema definition.
 * @param {Object|null} logger - Optional logger instance.
 * @returns {string} SQL statement for creating the table and any defined indexes.
 * @throws {SchemaDefinitionError} If a foreign key reference is invalid.
 */
function createTableSQL(schema, logger = null) {
  // Extract schema components: schema name, table name, columns, and constraints
  const { dbSchema, table, columns, constraints = {} } = schema;
  const schemaName = dbSchema || 'public';

  // Build column definitions with types, NOT NULL, and DEFAULT clauses
  const columnDefs = columns.map(col => {
    // Support for generated columns
    if (col.generated && col.expression) {
      let def = `"${col.name}" ${col.type} GENERATED ${col.generated.toUpperCase()} AS (${col.expression})${col.stored ? ' STORED' : ''}`;
      return def;
    }
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

        // Quote unquoted, non-function, non-numeric strings
        const isSQLFunction = /\b\w+\(.*\)/.test(defaultValue);
        const isNumeric = /^-?\d+(\.\d+)?$/.test(defaultValue);
        if (!isSQLFunction && !isNumeric && !/^'.*'$/.test(defaultValue)) {
          defaultValue = `'${defaultValue}'`;
        }
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
        throw new SchemaDefinitionError(`Invalid foreign key reference for table ${table}: expected object, got ${typeof fk.references}`);
      }

      const hash = createHash(table + fk.references.table + fk.columns.join('_'));
      const constraintName = `fk_${table}_${hash}`;

      const [refSchema, refTable] = fk.references.table.includes('.') ? fk.references.table.split('.') : [schemaName, fk.references.table];

      tableConstraints.push(`CONSTRAINT "${constraintName}" FOREIGN KEY (${fk.columns.map(c => `"${c}"`).join(', ')}) ` + `REFERENCES "${refSchema}"."${refTable}" (${fk.references.columns.map(c => `"${c}"`).join(', ')})` + (fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '') + (fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : ''));
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
  );`.trim();

  let finalSQL = sql;

  // Automatically include index creation if indexes are defined in the schema
  const indexDefinitions = resolveIndexes(schema);
  if (indexDefinitions) {
    try {
      const indexSQL = createIndexesSQL(schema, false, logger);
      finalSQL += '\n' + indexSQL;
    } catch (error) {
      // If createIndexesSQL throws an error, log it but don't fail the table creation
      logMessage({
        logger,
        level: 'debug',
        schema: schemaName,
        table,
        message: 'Error generating index SQL',
        data: { error: error.message },
      });
    }
  }

  logMessage({
    logger,
    level: 'debug',
    schema: schemaName,
    table,
    message: indexDefinitions ? 'Generated CREATE TABLE SQL with indexes' : 'Generated CREATE TABLE SQL',
    data: { sql: finalSQL },
  });

  // if (table === 'costlines') {
  //   console.log('costlines sql', finalSQL);
  // }
  return finalSQL;
}

/**
 * @private
 *
 * Appends standard audit fields to a table schema's column list if not already present.
 * Supports both boolean and object configuration formats for hasAuditFields.
 *
 * @param {TableSchema} schema - The table schema to modify.
 * @returns {TableSchema} The updated schema with audit fields.
 */
function addAuditFields(schema) {
  const { columns } = schema;

  // Determine if audit fields should be added
  let shouldAddAuditFields = false;
  let userFieldsConfig = {
    type: 'varchar(50)',
    nullable: true,
    default: null,
  };

  if (schema?.hasAuditFields) {
    if (typeof schema.hasAuditFields === 'boolean') {
      // Backward compatibility: simple boolean true
      shouldAddAuditFields = schema.hasAuditFields;
    } else if (typeof schema.hasAuditFields === 'object') {
      // New object format
      shouldAddAuditFields = schema.hasAuditFields.enabled === true;

      // Merge user-provided userFields with defaults
      if (schema.hasAuditFields.userFields) {
        const userFields = schema.hasAuditFields.userFields;
        userFieldsConfig = {
          type: userFields.type || 'varchar(50)',
          nullable: userFields.nullable !== undefined ? userFields.nullable : true,
          default: userFields.default !== undefined ? userFields.default : null,
        };
      }
    }
  }

  if (shouldAddAuditFields) {
    // Build user field definition based on configuration
    const userFieldDef = {
      type: userFieldsConfig.type,
    };

    // Add default value
    // For backward compatibility, always default to 'system' for boolean format
    if (userFieldsConfig.default !== null) {
      userFieldDef.default = userFieldsConfig.default;
    } else if (typeof schema.hasAuditFields === 'boolean') {
      // Boolean format: always use 'system' default (backward compatibility)
      userFieldDef.default = `'system'`;
    } else if (!userFieldsConfig.nullable) {
      // Object format with non-nullable: use 'system' default
      userFieldDef.default = `'system'`;
    }
    // Otherwise, no default (nullable with null default)

    const auditFields = [
      {
        name: 'created_at',
        type: 'timestamptz',
        default: 'now()',
        immutable: true,
      },
      {
        name: 'created_by',
        ...userFieldDef,
        immutable: true,
      },
      { name: 'updated_at', type: 'timestamptz', default: 'now()' },
      { name: 'updated_by', ...userFieldDef },
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
 * @param {Object|null} logger - Optional logger instance.
 * @returns {string} One or more SQL CREATE INDEX statements.
 * @throws {SchemaDefinitionError} If no indexes are defined in the schema.
 */
function createIndexesSQL(schema, unique = false, logger = null) {
  const indexes = resolveIndexes(schema);
  // Ensure that index definitions are present in the schema
  if (!indexes) {
    throw new SchemaDefinitionError('No indexes defined in schema');
  }

  const schemaName = schema.dbSchema || schema.schemaName || 'public';

  const indexSQL = indexes.map(index => {
    // Support both old format { columns: [...] } and new format with more options
    const columns = index.columns || [];
    if (columns.length === 0) {
      throw new SchemaDefinitionError(`Index definition must have at least one column for table ${schema.table}`);
    }

    // Generate index name - allow custom names or generate automatically
    let indexName;
    if (index.name) {
      indexName = index.name;
    } else {
      const prefix = unique || index.unique ? 'uidx' : 'idx';
      indexName = `${prefix}_${schema.table}_${columns.join('_')}`.toLowerCase();
    }

    // Build the CREATE INDEX statement
    let sql = 'CREATE';

    // Handle unique indexes
    if (unique || index.unique) {
      sql += ' UNIQUE';
    }

    sql += ` INDEX`;

    // Add IF NOT EXISTS unless explicitly disabled
    if (index.ifNotExists !== false) {
      sql += ' IF NOT EXISTS';
    }

    sql += ` "${indexName}"`;
    sql += ` ON "${schemaName}"."${schema.table}"`;

    // Handle index method (btree, gin, gist, hash, spgist, brin)
    if (index.using) {
      sql += ` USING ${index.using.toUpperCase()}`;
    }

    // Handle column expressions and operators
    const columnExpressions = columns.map(col => {
      if (typeof col === 'string') {
        // Simple column name
        return `"${col}"`;
      } else if (typeof col === 'object' && col.column) {
        // Column with options: { column: 'name', opclass: 'text_ops', order: 'DESC' }
        let expr = `"${col.column}"`;
        if (col.opclass) {
          expr += ` ${col.opclass}`;
        }
        if (col.order && ['ASC', 'DESC'].includes(col.order.toUpperCase())) {
          expr += ` ${col.order.toUpperCase()}`;
        }
        return expr;
      } else {
        // Treat as expression string
        return col.toString();
      }
    });

    sql += ` (${columnExpressions.join(', ')})`;

    // Handle partial indexes (WHERE clause)
    if (index.where) {
      sql += ` WHERE ${index.where}`;
    }

    // Handle storage parameters (WITH clause)
    if (index.with && typeof index.with === 'object') {
      const params = Object.entries(index.with).map(([key, value]) => {
        if (typeof value === 'string') {
          return `${key} = '${value}'`;
        }
        return `${key} = ${value}`;
      });
      sql += ` WITH (${params.join(', ')})`;
    }

    // Handle tablespace
    if (index.tablespace) {
      sql += ` TABLESPACE ${index.tablespace}`;
    }

    return sql + ';';
  });

  logMessage({
    logger,
    level: 'debug',
    schema: schemaName,
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
  if (Object.prototype.hasOwnProperty.call(schema, 'hasAuditFields') && hasAuditFields !== schema.hasAuditFields) {
    const message = hasAuditFields ? 'Cannot use create_at, created_by, updated_at, updated_by in your schema definition' : 'Audit fields have been removed from the schema. Set schema.hasAuditFields = false to avoid this error';
    throw new SchemaDefinitionError(message);
  }

  // Transform schema columns into ColumnSet configurations
  const columns = columnsetColumns
    .map(col => {
      const isPrimaryKey = schema.constraints?.primaryKey?.includes(col.name);
      const hasDefault = Object.prototype.hasOwnProperty.call(col, 'default');

      // Skip serial or UUID primary keys with defaults
      if (col.type === 'serial' || (col.type === 'uuid' && isPrimaryKey && hasDefault)) {
        return null;
      }

      // Exclude 'validator' from col.colProps when building columnObject
      const colPropsWithoutValidator = { ...(col.colProps ?? {}) };
      delete colPropsWithoutValidator.validator;
      const columnObject = {
        name: col.name,
        ...colPropsWithoutValidator,
        def: Object.prototype.hasOwnProperty.call(col, 'default') ? col.default : col.colProps?.def ?? undefined,
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
          throw new SchemaDefinitionError(`Invalid colProps.skip for column "${col.name}": expected function, got ${typeof skip}`);
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
