'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import crypto from 'crypto';

function createHash(input) {
  return crypto.createHash('md5').update(input).digest('hex').slice(0, 6);
}

function createTableSQL(schema) {
  const { schemaName, table, columns, constraints = {} } = schema;

  const columnDefs = columns.map(col => {
    let def = `"${col.name}" ${col.type}`;
    if (col.notNull) def += ' NOT NULL';
    if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
    return def;
  });

  const tableConstraints = [];

  // Primary Key
  if (constraints.primaryKey) {
    tableConstraints.push(
      `PRIMARY KEY (${constraints.primaryKey.map(c => `"${c}"`).join(', ')})`
    );
  }

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

  // Foreign Keys
  if (constraints.foreignKeys) {
    for (const fk of constraints.foreignKeys) {
      if (typeof fk.references !== 'object') {
        console.log(
          'Invalid foreign key reference:',
          fk.references,
          `got ${typeof fk.references}`
        );
        throw new Error(
          `Invalid foreign key reference for table ${table}: expected object, got ${typeof fk.references}`
        );
        continue;
      }

      const hash = createHash(
        table + fk.references.table + fk.columns.join('_')
      );
      const constraintName = `fk_${table}_${
        fk.references.table
      }_${fk.columns.join('_')}_${hash}`;

      tableConstraints.push(
        `CONSTRAINT "${constraintName}" FOREIGN KEY (${fk.columns
          .map(c => `"${c}"`)
          .join(', ')}) ` +
          `REFERENCES "${fk.references.schema}"."${
            fk.references.table
          }" (${fk.references.columns.map(c => `"${c}"`).join(', ')})` +
          (fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '') +
          (fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '')
      );
    }
  }

  // Check Constraints
  if (constraints.checks) {
    for (const check of constraints.checks) {
      tableConstraints.push(`CHECK (${check.expression})`);
    }
  }

  // Combine all
  const allDefs = columnDefs.concat(tableConstraints).join(',\n  ');

  const sql = `
  CREATE TABLE IF NOT EXISTS "${schemaName}"."${table}" (
    ${allDefs}
  );
  `.trim();

  return sql;
}

function addAuditFields(schema) {
  const { columns } = schema;
  columns.push(
    {
      name: 'created_at',
      type: 'timestamp',
      default: 'now()',
      immutable: true,
    },
    {
      name: 'created_by',
      type: 'varchar(50)',
      default: 'system',
      immutable: true,
    },
    { name: 'updated_at', type: 'timestamp', default: 'now()' },
    { name: 'updated_by', type: 'varchar(50)', default: 'system' }
  );

  return schema;
}

function createIndexesSQL(schema, unique = false, where = null) {
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

function normalizeSQL(sql) {
  return sql.replace(/\s+/g, ' ').replace(/;$/, '').trim();
}

export { createTableSQL, addAuditFields, createIndexesSQL, normalizeSQL };
