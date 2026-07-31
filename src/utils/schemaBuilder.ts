/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
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
import type { IMain } from 'pg-promise';
import type {
  ColPropsContext,
  ColumnDefinition,
  IndexDefinition,
  Logger,
  TableSchema,
} from '../schemaTypes.js';
import type { TableColumnSets } from '../internalTypes.js';

const columnSetCache = new LRUCache<string, TableColumnSets>({
  max: 20000,
  ttl: 1000 * 60 * 60,
});
// Cache for storing generated ColumnSets to avoid redundant computations

/**
 * pg-promise custom-type-formatting sentinel emitting raw SQL.
 */
interface RawSqlDefault {
  rawType: true;
  toPostgres: () => string;
}

// Raw-type sentinel used as the ColumnSet `def` for columns with a SQL
// default: pg-promise emits the bare DEFAULT keyword when the property is
// missing from the DTO, letting Postgres apply the column default.
const RAW_DEFAULT: RawSqlDefault = {
  rawType: true,
  toPostgres: () => 'DEFAULT',
};

/**
 * Column configuration handed to pg-promise's ColumnSet: the schema
 * column's colProps minus the pg-schemata-only `validator` key.
 */
interface ColumnSetColumn {
  name: string;
  mod?: string;
  skip?: (col: ColPropsContext) => boolean;
  cnd?: boolean;
  init?: (col: ColPropsContext) => unknown;
  def?: unknown;
}

/**
 * Creates a short MD5-based hash of the input string.
 *
 * @param input - Value to hash.
 * @returns A 6-character hex hash.
 */
function createHash(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 6);
}

/**
 * @private
 *
 * Resolves index definitions from either the legacy top-level `indexes`
 * property or the newer `constraints.indexes` location.
 *
 * @param schema - Structured schema definition.
 * @returns Array of index definitions if present.
 */
function resolveIndexes(schema: TableSchema): IndexDefinition[] | undefined {
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
 * @param schema - Structured schema definition.
 * @param logger - Optional logger instance.
 * @returns SQL statement for creating the table and any defined indexes.
 * @throws {SchemaDefinitionError} If a foreign key reference is invalid.
 */
function createTableSQL(
  schema: TableSchema,
  logger: Logger | null = null
): string {
  // Extract schema components: schema name, table name, columns, and constraints
  const { dbSchema, table, columns, constraints = {} } = schema;
  const schemaName = dbSchema || schema.schemaName || 'public';

  // Build column definitions with types, NOT NULL, and DEFAULT clauses
  const columnDefs = columns.map(col => {
    // Support for generated columns
    if (col.generated && col.expression) {
      const def = `"${col.name}" ${col.type} GENERATED ${col.generated.toUpperCase()} AS (${col.expression})${col.stored ? ' STORED' : ''}`;
      return def;
    }
    let def = `"${col.name}" ${col.type}`;
    if (col.notNull) def += ' NOT NULL';
    if (col.default !== undefined) {
      let defaultValue = col.default;
      if (typeof defaultValue === 'string') {
        // Quote unquoted, non-function, non-numeric strings
        const isSQLFunction = /\b\w+\(.*\)/.test(defaultValue);
        const isNumeric = /^-?\d+(\.\d+)?$/.test(defaultValue);
        // Also check for quoted strings with type casts like '{}'::uuid[]
        const isQuotedWithCast = /^'.*'::\w+/.test(defaultValue);
        if (
          !isSQLFunction &&
          !isNumeric &&
          !isQuotedWithCast &&
          !/^'.*'$/.test(defaultValue)
        ) {
          // Escape embedded quotes so a legitimate default like O'Brien
          // produces valid DDL (issue 7).
          defaultValue = `'${defaultValue.replace(/'/g, "''")}'`;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions -- schema defaults are scalars/SQL expressions; implicit stringification is the documented behavior
      def += ` DEFAULT ${defaultValue}`;
    }
    return def;
  });

  // Initialize list to hold table-level constraints
  const tableConstraints: string[] = [];

  // Handle PRIMARY KEY constraint
  // Primary Key
  if (constraints.primaryKey) {
    tableConstraints.push(
      `PRIMARY KEY (${constraints.primaryKey.map(c => `"${c}"`).join(', ')})`
    );
  }

  // Handle UNIQUE constraints with generated names
  // Unique Constraints - supports both string[] (simple) and object (with options) formats
  if (constraints.unique) {
    for (const uniqueDef of constraints.unique) {
      // Support both string[] and UniqueConstraintDefinition object formats
      const isObject = !Array.isArray(uniqueDef);
      const uniqueCols = isObject ? uniqueDef.columns : uniqueDef;
      const nullsNotDistinct = isObject && uniqueDef.nullsNotDistinct;

      const hash = createHash(table + uniqueCols.join('_'));
      const constraintName =
        isObject && uniqueDef.name
          ? uniqueDef.name
          : `uidx_${table}_${uniqueCols.join('_')}_${hash}`;

      let clause = `CONSTRAINT "${constraintName}" UNIQUE`;
      if (nullsNotDistinct) {
        clause += ' NULLS NOT DISTINCT';
      }
      clause += ` (${uniqueCols.map(c => `"${c}"`).join(', ')})`;
      tableConstraints.push(clause);
    }
  }

  // Handle FOREIGN KEY constraints with ON DELETE/UPDATE rules
  // Foreign Keys
  if (constraints.foreignKeys) {
    for (const fk of constraints.foreignKeys) {
      if (typeof fk.references !== 'object' || fk.references === null) {
        throw new SchemaDefinitionError(
          `Invalid foreign key reference for table ${table}: expected object, got ${typeof fk.references}`
        );
      }

      const isDotted = fk.references.table.includes('.');
      let refSchema;
      let refTable;
      if (isDotted) {
        const dotIdx = fk.references.table.indexOf('.');
        const left = fk.references.table.slice(0, dotIdx);
        const right = fk.references.table.slice(dotIdx + 1);
        if (!left || !right || right.includes('.')) {
          throw new SchemaDefinitionError(
            `Invalid foreign key reference for table ${table}: expected '<schema>.<table>', got '${fk.references.table}'`
          );
        }
        refSchema = left;
        refTable = right;
      } else {
        refSchema = fk.references.schema ?? schemaName;
        refTable = fk.references.table;
      }

      // Hash only mixes in references.schema when it actually drives resolution
      // (i.e. the table is not dotted). Dotted form ignores references.schema, so
      // it must not affect the constraint name either.
      const hashSchemaPart =
        !isDotted && fk.references.schema ? fk.references.schema : '';
      const hash = createHash(
        table + fk.references.table + hashSchemaPart + fk.columns.join('_')
      );
      const constraintName = `fk_${table}_${hash}`;

      tableConstraints.push(
        `CONSTRAINT "${constraintName}" FOREIGN KEY (${fk.columns.map(c => `"${c}"`).join(', ')}) ` +
          `REFERENCES "${refSchema}"."${refTable}" (${fk.references.columns.map(c => `"${c}"`).join(', ')})` +
          (fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '') +
          (fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '')
      );
    }
  }

  // Handle CHECK constraints
  // Check Constraints
  if (constraints.checks) {
    for (const check of constraints.checks) {
      // Bare expression strings are accepted alongside the object form.
      const expression = typeof check === 'string' ? check : check.expression;
      tableConstraints.push(`CHECK (${expression})`);
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
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  logMessage({
    logger,
    level: 'debug',
    schema: schemaName,
    table,
    message: indexDefinitions
      ? 'Generated CREATE TABLE SQL with indexes'
      : 'Generated CREATE TABLE SQL',
    data: { sql: finalSQL },
  });

  return finalSQL;
}

/**
 * @private
 *
 * Appends standard audit fields to a table schema's column list if not already present.
 * Supports both boolean and object configuration formats for hasAuditFields.
 *
 * @param schema - The table schema to modify.
 * @returns The updated schema with audit fields.
 */
function addAuditFields(schema: TableSchema): TableSchema {
  const { columns } = schema;

  // Determine if audit fields should be added
  let shouldAddAuditFields = false;
  let userFieldsConfig: {
    type: string;
    nullable: boolean;
    default: unknown;
  } = {
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
          nullable:
            userFields.nullable !== undefined ? userFields.nullable : true,
          default: userFields.default !== undefined ? userFields.default : null,
        };
      }
    }
  }

  if (shouldAddAuditFields) {
    // Build user field definition based on configuration
    const userFieldDef: {
      type: string;
      notNull?: boolean;
      default?: unknown;
    } = {
      type: userFieldsConfig.type,
    };

    // The userFields config option `nullable` previously went nowhere: DDL
    // generation reads notNull, so non-nullable user fields were created
    // nullable anyway (N6).
    if (userFieldsConfig.nullable === false) {
      userFieldDef.notNull = true;
    }

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

    const auditFields: ColumnDefinition[] = [
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

  return schema;
}

/**
 * @private
 *
 * Appends the `deactivated_at` column to a table schema when soft delete is
 * enabled and the column is not already present.
 *
 * @param schema - The table schema to modify.
 * @returns The updated schema.
 */
function addSoftDeleteField(schema: TableSchema): TableSchema {
  if (schema?.softDelete) {
    const hasDeactivatedAt = schema.columns.some(
      col => col.name === 'deactivated_at'
    );
    if (!hasDeactivatedAt) {
      schema.columns.push({
        name: 'deactivated_at',
        type: 'timestamptz',
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
 * @param schema - Structured schema object.
 * @param unique - Whether to treat all indexes as unique.
 * @param logger - Optional logger instance.
 * @returns One or more SQL CREATE INDEX statements.
 * @throws {SchemaDefinitionError} If no indexes are defined in the schema.
 */
function createIndexesSQL(
  schema: TableSchema,
  unique = false,
  logger: Logger | null = null
): string {
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
      throw new SchemaDefinitionError(
        `Index definition must have at least one column for table ${schema.table}`
      );
    }

    // Generate index name - allow custom names or generate automatically
    let indexName;
    if (index.name) {
      indexName = index.name;
    } else {
      const prefix = unique || index.unique ? 'uidx' : 'idx';
      indexName =
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- auto-generated names from object-form columns match the historical behavior
        `${prefix}_${schema.table}_${columns.join('_')}`.toLowerCase();
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
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- runtime fallback for raw expression inputs outside the declared type
        return String(col);
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
 * @param sql - Raw SQL string.
 * @returns Normalized SQL.
 */
function normalizeSQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;$/, '').trim();
}

/**
 * @private
 *
 * Validates column definitions to ensure colProps.skip is a function if provided.
 *
 * @param columns - Array of column definitions.
 * @throws {SchemaDefinitionError} If colProps.skip is invalid.
 */
function validateColumnProps(columns: ColumnDefinition[]): void {
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

/**
 * @private
 *
 * Generates pg-promise ColumnSet definitions for insert and update operations.
 *
 * @param schema - Parsed table schema.
 * @param pgp - pg-promise instance.
 * @param logger - Optional logger instance.
 * @returns A ColumnSet object with insert/update variants.
 * @throws {SchemaDefinitionError} If audit field state or colProps are invalid.
 */
function createColumnSet(
  schema: TableSchema,
  pgp: IMain,
  logger: Logger | null = null
): TableColumnSets {
  // Check if the schema is already cached
  const cacheKey = `${schema.table}::${schema.dbSchema}`;
  const cached = columnSetCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  validateColumnProps(schema.columns);

  // Define standard audit field names to exclude from base ColumnSet
  const auditFields = ['created_at', 'created_by', 'updated_at', 'updated_by'];
  // Remove audit fields from the list of columns
  const columnsetColumns = schema.columns.filter(
    col => !auditFields.includes(col.name)
  );

  const hasAuditFields = columnsetColumns.length !== schema.columns.length;

  // Validate that audit fields have been added correctly
  // Support both boolean and object format for hasAuditFields
  const schemaHasAuditFieldsEnabled =
    typeof schema.hasAuditFields === 'boolean'
      ? schema.hasAuditFields
      : schema.hasAuditFields?.enabled === true;

  if (
    Object.prototype.hasOwnProperty.call(schema, 'hasAuditFields') &&
    hasAuditFields !== schemaHasAuditFieldsEnabled
  ) {
    const message = hasAuditFields
      ? 'Cannot use created_at, created_by, updated_at, updated_by in your schema definition'
      : 'Audit fields have been removed from the schema. Set schema.hasAuditFields = false to avoid this error';
    throw new SchemaDefinitionError(message);
  }

  // Transform schema columns into ColumnSet configurations
  const columns = columnsetColumns
    .map(col => {
      const isPrimaryKey = schema.constraints?.primaryKey?.includes(col.name);
      const hasDefault = Object.prototype.hasOwnProperty.call(col, 'default');

      // Skip serial or UUID primary keys with defaults
      if (
        col.type === 'serial' ||
        (col.type === 'uuid' && isPrimaryKey && hasDefault)
      ) {
        return null;
      }

      // Exclude 'validator' from col.colProps when building columnObject
      const colPropsWithoutValidator = { ...(col.colProps ?? {}) };
      delete colPropsWithoutValidator.validator;
      const columnObject: ColumnSetColumn = {
        name: col.name,
        ...colPropsWithoutValidator,
        // `def` is a JavaScript substitution value, not raw SQL. A column with
        // a SQL default must emit the DEFAULT keyword when absent from the DTO,
        // not the text of its own default expression (issue N3).
        def: Object.prototype.hasOwnProperty.call(col, 'default')
          ? RAW_DEFAULT
          : (col.colProps?.def ?? undefined),
      };

      return columnObject;
    })
    .filter((col): col is ColumnSetColumn => col !== null); // Remove nulls (skipped columns)

  // Instantiate ColumnSet for base table operations
  const baseCs = new pgp.helpers.ColumnSet(columns, {
    table: {
      table: schema.table,
      schema: schema.dbSchema || 'public',
    },
  });

  // Create separate ColumnSet variants for insert and update to include audit fields.
  // The insert variant carries both `created_by` and `updated_by` so the mirror-on-
  // insert behavior in TableModel.insert() (which uses this.cs.insert) actually
  // persists `updated_by` — pg-promise omits any column not in the ColumnSet, so
  // the DTO assignment alone wouldn't reach the SQL.
  // bulkInsert() builds its own ColumnSet from the safeRecords keys and does not
  // depend on this cs.insert.
  const cs: TableColumnSets = hasAuditFields
    ? {
        [schema.table]: baseCs,
        insert: baseCs.extend(['created_by', 'updated_by']),
        update: baseCs.extend([
          {
            name: 'updated_at',
            mod: '^',
            def: 'CURRENT_TIMESTAMP',
          },
          'updated_by',
        ]),
      }
    : {
        [schema.table]: baseCs,
        insert: baseCs,
        update: baseCs,
      };

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

export {
  createTableSQL,
  addAuditFields,
  addSoftDeleteField,
  createIndexesSQL,
  normalizeSQL,
  createColumnSet,
  columnSetCache,
};
