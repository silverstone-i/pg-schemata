/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import QueryModel from '../../src/QueryModel.js';
import TableModel from '../../src/TableModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import {
  columnSetCache,
  createIndexesSQL,
  createTableSQL,
} from '../../src/utils/schemaBuilder.js';
import type { IMain } from 'pg-promise';
import type {
  DbConnection,
  IndexColumn,
  IndexDefinition,
  TableSchema,
} from '../../src/schemaTypes.js';

const pgp = { helpers: { ColumnSet: vi.fn(() => ({})) } } as unknown as IMain;
const db = {} as DbConnection;
const expressionIndex: IndexDefinition = {
  name: 'portal_users_active_email',
  columns: [{ expression: 'lower(email)' }],
  unique: true,
  where: 'deactivated_at IS NULL',
};
function schema(index: IndexDefinition): TableSchema {
  return {
    dbSchema: 'tenant',
    table: 'portal_users',
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'email', type: 'text' },
      { name: 'deactivated_at', type: 'timestamptz' },
    ],
    constraints: { primaryKey: ['id'], indexes: [index] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  columnSetCache.clear();
});

describe('explicit expression indexes', () => {
  it('generates the complete unique partial index statement', () => {
    const expected =
      'CREATE UNIQUE INDEX IF NOT EXISTS "portal_users_active_email" ON "tenant"."portal_users" ((lower(email))) WHERE deactivated_at IS NULL;';
    expect(createIndexesSQL(schema(expressionIndex))).toBe(expected);
    expect(createTableSQL(schema(expressionIndex))).toContain(expected);
  });

  it('supports mixed columns, options, and general SQL expressions', () => {
    expect(
      createIndexesSQL(
        schema({
          name: 'mixed_index',
          columns: [
            'id',
            { column: 'email', opclass: 'text_ops', order: 'DESC' },
            { expression: "email || '@example.com'" },
          ],
          ifNotExists: false,
        })
      )
    ).toBe(
      'CREATE INDEX "mixed_index" ON "tenant"."portal_users" ("id", "email" text_ops DESC, (email || \'@example.com\'));'
    );
  });

  it('retains automatic names for plain columns and the unique override', () => {
    expect(createIndexesSQL(schema({ columns: ['email'] }), true)).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uidx_portal_users_email" ON "tenant"."portal_users" ("email");'
    );
  });

  it('excludes mixed objects from the public type even through variables', () => {
    expectTypeOf<{ expression: string }>().toMatchTypeOf<IndexColumn>();
    expectTypeOf<{
      expression: string;
      column: string;
    }>().not.toMatchTypeOf<IndexColumn>();
  });

  for (const Model of [QueryModel, TableModel]) {
    it(`${Model.name} accepts the explicit expression form`, () => {
      expect(() => new Model(db, pgp, schema(expressionIndex))).not.toThrow();
    });
  }

  it.each([
    { columns: [{ expression: 'lower(email)' }] },
    { name: '', columns: [{ expression: 'lower(email)' }] },
    {
      name: 'bad"; DROP TABLE users; --',
      columns: [{ expression: 'lower(email)' }],
    },
    { name: 'x'.repeat(64), columns: [{ expression: 'lower(email)' }] },
    ...['', '   ', '\n\t', null, undefined, 42].map(expression => ({
      name: 'valid_index',
      columns: [{ expression }],
    })),
    {
      name: 'valid_index',
      columns: [{ expression: 'lower(email)', column: 'email' }],
    },
    {
      name: 'valid_index',
      columns: [{ expression: 'lower(email)', column: undefined }],
    },
    { columns: ['lower(email)'] },
    { columns: [{ column: 'lower(email)' }] },
    { columns: ['email"; DROP TABLE users; --'] },
    {
      name: 'valid_index',
      columns: [{ expression: 'lower(email)' }, { column: 'bad"' }],
    },
  ])('rejects invalid definitions consistently: %j', index => {
    const input = schema(index as unknown as IndexDefinition);
    for (const generate of [createIndexesSQL, createTableSQL]) {
      expect(() => generate(input)).toThrow(SchemaDefinitionError);
    }
    for (const Model of [QueryModel, TableModel]) {
      expect(() => new Model(db, pgp, input)).toThrow(SchemaDefinitionError);
    }
  });
});
