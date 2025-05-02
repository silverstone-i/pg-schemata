'use strict';
/**
 * @fileoverview
 * Utility functions for generating SQL statements and pg-promise ColumnSets
 * based on a structured schema definition.
 */

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import crypto from 'crypto';
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
 * Generates a CREATE TABLE SQL statement based on a schema definition.
 *
 * @param {Object} schema - Schema definition object.
 * @param {string} schema.dbSchema - Schema name (defaults to 'public').
 * @param {string} schema.table - Table name.
 * @param {Array} schema.columns - Array of column definition objects.
 * @param {Object} [schema.constraints] - Constraints like primary key, foreign keys, and indexes.
 * @returns {string} SQL statement to create the table.
 */
function createTableSQL(schema) {
  // Extract schema components: schema name, table name, columns, and constraints
  const { dbSchema, table, columns, constraints = {} } = schema;
  const schemaName = dbSchema || 'public';

  // Build column definitions with types, NOT NULL, and DEFAULT clauses
  const columnDefs = columns.map(col => {
    let def = `"${col.name}" ${col.type}`;
    if (col.notNull) def += ' NOT NULL';
    if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
    return def;
  });

  // Initialize list to hold table-level constraints
  const tableConstraints = [];

  // Handle PRIMARY KEY constraint
  // Primary Key
  if (constraints.primaryKey) {
    tableConstraints.push(
      `PRIMARY KEY (${constraints.primaryKey.map(c => `"${c}"`).join(', ')})`
    );
  }

  // Handle UNIQUE constraints with generated names
  // Unique Constraints
  if (constraints.unique) {
    for (const uniqueCols of constraints.unique) {
      const hash = createHash(table + uniqueCols.join('_'));
      const constraintName = `uidx_${table}_${uniqueCols.join('_')}_${hash}`;
      tableConstraints.push(
        `CONSTRAINT "${constraintName}" UNIQUE (${uniqueCols
          .map(c => `"${c}"`)
          .join(', ')})`
      );
    }
  }

  // Handle FOREIGN KEY constraints with ON DELETE/UPDATE rules
  // Foreign Keys
  if (constraints.foreignKeys) {
    for (const fk of constraints.foreignKeys) {
      if (typeof fk.references !== 'object') {
        throw new Error(
          `Invalid foreign key reference for table ${table}: expected object, got ${typeof fk.references}`
        );
      }

      const hash = createHash(
        table + fk.references.table + fk.columns.join('_')
      );
      const constraintName = `fk_${table}_${hash}`;

      {
        const hash = createHash(
          table + fk.references.table + fk.columns.join('_')
        );
        const constraintName = `fk_${table}_${hash}`;

        const [refSchema, refTable] = fk.references.table.includes('.')
          ? fk.references.table.split('.')
          : [schemaName, fk.references.table];

        tableConstraints.push(
          `CONSTRAINT "${constraintName}" FOREIGN KEY (${fk.columns
            .map(c => `"${c}"`)
            .join(', ')}) ` +
            `REFERENCES "${refSchema}"."${refTable}" (${fk.references.columns
              .map(c => `"${c}"`)
              .join(', ')})` +
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

  // if (table === 'costlines') {
  //   console.log('costlines sql', sql);
  // }

  return sql;
}

/**
 * Appends standard audit fields to a schema's column list.
 *
 * @param {Object} schema - Schema definition to augment.
 * @returns {Object} Modified schema including audit fields.
 */
function addAuditFields(schema) {
  const { columns } = schema;
  const auditFields = [
    {
      name: 'created_at',
      type: 'timestamp',
      default: 'now()',
      immutable: true,
    },
    {
      name: 'created_by',
      type: 'varchar(50)',
      default: `'system'`,
      immutable: true,
    },
    { name: 'updated_at', type: 'timestamp', default: 'now()' },
    { name: 'updated_by', type: 'varchar(50)', default: `'system'` },
  ];

  for (const auditField of auditFields) {
    if (!columns.find(col => col.name === auditField.name)) {
      columns.push(auditField);
    }
  }

  return schema;
}

/**
 * Generates CREATE INDEX statements based on schema-defined indexes.
 *
 * @param {Object} schema - Schema with defined indexes in the constraints.
 * @param {boolean} [unique] - If true, creates unique indexes.
 * @param {string|null} [where] - Optional WHERE clause for partial indexes.
 * @returns {string} SQL statements to create indexes.
 */
function createIndexesSQL(schema, unique = false, where = null) {
  // Ensure that index definitions are present in the schema
  if (!schema.constraints || !schema.constraints.indexes) {
    throw new Error('No indexes defined in schema');
  }

  const { indexes } = schema.constraints;

  const indexSQL = indexes.map(index => {
    const indexName = `${unique ? 'uidx' : 'idx'}_${
      schema.table
    }_${index.columns.join('_')}`.toLowerCase();
    return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${
      schema.schemaName
    }"."${schema.table}" (${index.columns.join(', ')});`;
  });

  return indexSQL.join('\n');
}

/**
 * Normalizes SQL by removing excessive whitespace and trailing semicolons.
 *
 * @param {string} sql - The SQL string to normalize.
 * @returns {string} The normalized SQL string.
 */
function normalizeSQL(sql) {
  return sql.replace(/\s+/g, ' ').replace(/;$/, '').trim();
}

/**
 * Creates pg-promise ColumnSet objects for insert and update operations.
 *
 * @param {Object} schema - Schema definition including columns and constraints.
 * @param {Object} pgp - pg-promise instance with helpers.
 * @returns {Object} ColumnSet configurations for insert and update.
 */
function createColumnSet(schema, pgp) {
  // Define standard audit field names to exclude from base ColumnSet
  const auditFields = ['created_at', 'created_by', 'updated_at', 'updated_by'];
  // Remove audit fields from the list of columns
  const columnsetColumns = schema.columns.filter(
    col => !auditFields.includes(col.name)
  );

  const hasAuditFields = columnsetColumns.length !== schema.columns.length;

  // Validate that audit fields hav been added correctly
  if (
    schema.hasOwnProperty('hasAuditFields') &&
    hasAuditFields !== schema.hasAuditFields
  ) {
    const message = hasAuditFields
      ? 'Cannot use create_at, created_by, updated_at, updated_by in your schema definition'
      : 'Audit fields have been removed from the schema. Set schema.hasAuditFields = false to avoid this error';
    throw new Error(message);
  }

  // Transform schema columns into ColumnSet configurations
  const columns = columnsetColumns
    .map(col => {
      const isPrimaryKey = schema.constraints?.primaryKey?.includes(col.name);
      const hasDefault = col.hasOwnProperty('default');

      // Skip serial or UUID primary keys with defaults
      if (
        col.type === 'serial' ||
        (col.type === 'uuid' && isPrimaryKey && hasDefault)
      ) {
        return null;
      }

      const columnObject = {
        name: col.name,
        ...(col.colProps || {}),
        def: col.hasOwnProperty('default')
          ? col.default
          : col.colProps?.def ?? undefined,
      };

      return columnObject;
    })
    .filter(col => col !== null); // Remove nulls (skipped columns)

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

  // if (schema.table === 'clients') {
  //   console.log('cs', cs);
  // }

  return cs;
}

export {
  createTableSQL,
  addAuditFields,
  createIndexesSQL,
  normalizeSQL,
  createColumnSet,
};
