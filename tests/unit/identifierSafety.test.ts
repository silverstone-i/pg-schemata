/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// Query paths run every identifier through pgp.as.name(). DDL generation does
// not — it has no pg-promise instance and builds its statements as strings, so
// a schema, table, or column name carrying a double quote closed the quoting
// and appended whatever followed. Schema names are the sharp edge: in
// schema-per-tenant deployments they are routinely request-derived, and
// forSchema() accepted any non-empty string.
//
// These assert the guard, not the escaping. Rejecting the name outright is what
// keeps a future interpolation site from silently missing an escape.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import QueryModel from '../../src/QueryModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import {
  createTableSQL,
  createIndexesSQL,
  columnSetCache,
} from '../../src/utils/schemaBuilder.js';
import type { IMain } from 'pg-promise';
import type { DbConnection, TableSchema } from '../../src/schemaTypes.js';

const fakePgp = {
  as: { name: vi.fn((x: string) => `"${x}"`), format: vi.fn((q: string) => q) },
  helpers: { ColumnSet: vi.fn(() => ({})) },
};
const mockDb = { any: vi.fn(), one: vi.fn() };

const INJECTION = 'tenant"; DROP TABLE customers; --';

function baseSchema(overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    dbSchema: 'public',
    table: 'widgets',
    columns: [
      { name: 'id', type: 'uuid', notNull: true },
      { name: 'label', type: 'text' },
    ],
    constraints: { primaryKey: ['id'] },
    ...overrides,
  };
}

function makeModel(schema: TableSchema) {
  return new QueryModel(
    mockDb as unknown as DbConnection,
    fakePgp as unknown as IMain,
    schema
  );
}

beforeEach(() => {
  columnSetCache.clear();
});

describe('createTableSQL identifier validation', () => {
  it('rejects a schema name that breaks out of its quoting', () => {
    // CREATE SCHEMA IF NOT EXISTS "tenant"; DROP TABLE customers; --"
    expect(() => createTableSQL(baseSchema({ dbSchema: INJECTION }))).toThrow(
      SchemaDefinitionError
    );
  });

  it('rejects an injected table name', () => {
    expect(() =>
      createTableSQL(baseSchema({ table: 'w"; DROP TABLE x; --' }))
    ).toThrow(/not a valid SQL identifier/);
  });

  it('rejects an injected column name', () => {
    expect(() =>
      createTableSQL(
        baseSchema({
          columns: [
            { name: 'id', type: 'uuid', notNull: true },
            { name: 'bad"); DROP TABLE x; --', type: 'text' },
          ],
        })
      )
    ).toThrow(/Column name/);
  });

  it('rejects an injected constraint column', () => {
    expect(() =>
      createTableSQL(
        baseSchema({
          constraints: { primaryKey: ['id"); DROP TABLE x; --'] },
        })
      )
    ).toThrow(/Primary key column/);
  });

  it('rejects an injected index name', () => {
    expect(() =>
      createTableSQL(
        baseSchema({
          constraints: {
            primaryKey: ['id'],
            indexes: [{ columns: ['label'], name: 'i"; DROP TABLE x; --' }],
          },
        })
      )
    ).toThrow(/Index name/);
  });

  it('rejects an identifier past the 63-byte limit', () => {
    // PostgreSQL truncates silently, so two schemas differing only past byte 63
    // collapse onto one.
    expect(() =>
      createTableSQL(baseSchema({ dbSchema: 'a'.repeat(64) }))
    ).toThrow(/63-byte identifier limit/);
  });

  it('accepts ordinary snake_case identifiers', () => {
    expect(() =>
      createTableSQL(
        baseSchema({ dbSchema: 'tenant_42', table: 'order_items' })
      )
    ).not.toThrow();
  });

  it('validates independently when createIndexesSQL is called directly', () => {
    // It is exported, so it cannot rely on having been reached via
    // createTableSQL.
    expect(() =>
      createIndexesSQL(
        baseSchema({
          dbSchema: INJECTION,
          constraints: {
            primaryKey: ['id'],
            indexes: [{ columns: ['label'] }],
          },
        })
      )
    ).toThrow(SchemaDefinitionError);
  });

  it('leaves the foreign-key shape errors to createTableSQL', () => {
    // Those messages name the owning table and the expected form; replacing
    // them with "not a valid identifier" would be a worse diagnostic.
    expect(() =>
      createTableSQL(
        baseSchema({
          constraints: {
            primaryKey: ['id'],
            foreignKeys: [
              {
                columns: ['id'],
                references: { table: 'a.b.c', columns: ['id'] },
              },
            ],
          },
        } as Partial<TableSchema>)
      )
    ).toThrow(/expected '<schema>\.<table>'/);
  });
});

describe('QueryModel identifier validation', () => {
  it('rejects an unusable schema name at construction', () => {
    expect(() => makeModel(baseSchema({ dbSchema: INJECTION }))).toThrow(
      SchemaDefinitionError
    );
  });

  it('rejects an unusable table name at construction', () => {
    expect(() => makeModel(baseSchema({ table: 'a b' }))).toThrow(
      /not a valid SQL identifier/
    );
  });

  it('forSchema rejects an injected schema name', () => {
    // The tenant-facing entry point, and the one most likely to be handed a
    // request-derived value.
    const model = makeModel(baseSchema());
    expect(() => model.forSchema(INJECTION)).toThrow(SchemaDefinitionError);
  });

  it('forSchema still rejects empty and non-string input', () => {
    const model = makeModel(baseSchema());
    expect(() => model.forSchema('')).toThrow(/non-empty string/);
    expect(() => model.forSchema('   ')).toThrow(/non-empty string/);
  });

  it('forSchema accepts a legitimate tenant schema', () => {
    const model = makeModel(baseSchema());
    expect(model.forSchema('tenant_abc').schema.dbSchema).toBe('tenant_abc');
  });
});

describe('joinType runtime guard', () => {
  it('rejects a joiner that is not AND or OR', () => {
    // JoinType erases at runtime and the value lands between predicates as raw
    // SQL, so a JavaScript caller could close the statement with it.
    const model = makeModel(baseSchema());
    expect(() =>
      model.buildCondition(
        [{ label: 'x' }, { label: 'y' }],
        'OR 1=1 --' as never
      )
    ).toThrow(SchemaDefinitionError);
  });

  it('rejects lowercase joiners, which 2.0.0 removed', () => {
    const model = makeModel(baseSchema());
    expect(() =>
      model.buildCondition([{ label: 'x' }], 'and' as never)
    ).toThrow(/'AND' or 'OR'/);
  });

  it('accepts AND and OR', () => {
    const model = makeModel(baseSchema());
    expect(() => model.buildCondition([{ label: 'x' }], 'AND')).not.toThrow();
    expect(() => model.buildCondition([{ label: 'x' }], 'OR')).not.toThrow();
  });

  it('guards the clause builder too', () => {
    const model = makeModel(baseSchema());
    expect(() =>
      model.buildWhereClause([{ label: 'x' }], true, [], 'OR 1=1 --' as never)
    ).toThrow(SchemaDefinitionError);
  });
});
