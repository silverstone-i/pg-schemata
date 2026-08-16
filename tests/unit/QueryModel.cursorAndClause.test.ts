/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// Four defects where the emitted SQL disagreed with the documented contract.
// Three are in findAfterCursor (docs/guide/cursor-pagination.md) and one is in
// buildWhereClause, which is public API (docs/reference/query-model.md).
//
// All four are SQL-text assertions, because the bug in each case is what the
// statement says, not what a particular row set comes back as.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import QueryModel from '../../src/QueryModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import type { IMain } from 'pg-promise';
import type { DbConnection, TableSchema } from '../../src/schemaTypes.js';

const fakePgp = {
  as: {
    name: vi.fn((x: string) => `"${x}"`),
    format: vi.fn((q: string) => q),
  },
  helpers: { ColumnSet: vi.fn(() => ({})) },
};

const mockDb = { any: vi.fn(), one: vi.fn() };

const schema: TableSchema = {
  dbSchema: 'test_schema',
  table: 'events',
  softDelete: false,
  constraints: { primaryKey: ['id'] },
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'occurred_at', type: 'timestamptz', notNull: true },
    { name: 'label', type: 'text' },
  ],
};

const softDeleteSchema: TableSchema = {
  ...schema,
  table: 'soft_events',
  softDelete: true,
  columns: [...schema.columns, { name: 'deactivated_at', type: 'timestamptz' }],
};

function makeModel(s: TableSchema = schema) {
  return new QueryModel(
    mockDb as unknown as DbConnection,
    fakePgp as unknown as IMain,
    s
  );
}

beforeEach(() => {
  mockDb.any.mockReset();
  mockDb.one.mockReset();
});

describe('findAfterCursor ORDER BY direction', () => {
  test('applies DESC to every ordering column, not just the last', async () => {
    // `ORDER BY a, b DESC` sorts a ascending. With a descending cursor
    // comparison of `(a, b) < (...)`, the ordering and the seek disagree and
    // pages silently skip or repeat rows.
    mockDb.any.mockResolvedValue([]);
    await makeModel().findAfterCursor({}, 10, ['occurred_at', 'id'], {
      descending: true,
    });

    const sql = mockDb.any.mock.calls[0]![0] as string;
    expect(sql).toContain('ORDER BY "occurred_at" DESC, "id" DESC');
  });

  test('applies ASC to every ordering column by default', async () => {
    mockDb.any.mockResolvedValue([]);
    await makeModel().findAfterCursor({}, 10, ['occurred_at', 'id']);

    const sql = mockDb.any.mock.calls[0]![0] as string;
    expect(sql).toContain('ORDER BY "occurred_at" ASC, "id" ASC');
  });

  test('leaves the cursor comparison tuple undecorated', async () => {
    // The seek predicate is a row constructor, which takes no direction — a
    // direction keyword inside it is a syntax error.
    mockDb.any.mockResolvedValue([]);
    await makeModel().findAfterCursor(
      { occurred_at: '2026-01-01', id: 'x' },
      10,
      ['occurred_at', 'id'],
      { descending: true }
    );

    const sql = mockDb.any.mock.calls[0]![0] as string;
    expect(sql).toContain('("occurred_at", "id") < ($1, $2)');
  });
});

describe('findAfterCursor columnWhitelist', () => {
  test('throws when the whitelist omits an ordering column', async () => {
    // Without the guard the projection drops occurred_at, the cursor comes back
    // as {occurred_at: undefined}, and feeding it to the next call is unusable.
    await expect(
      makeModel().findAfterCursor({}, 10, ['occurred_at', 'id'], {
        columnWhitelist: ['id', 'label'],
      })
    ).rejects.toThrow(SchemaDefinitionError);
  });

  test('names the missing columns', async () => {
    await expect(
      makeModel().findAfterCursor({}, 10, ['occurred_at', 'id'], {
        columnWhitelist: ['label'],
      })
    ).rejects.toThrow(/occurred_at, id/);
  });

  test('accepts a whitelist that covers every ordering column', async () => {
    mockDb.any.mockResolvedValue([]);
    await expect(
      makeModel().findAfterCursor({}, 10, ['id'], {
        columnWhitelist: ['id', 'label'],
      })
    ).resolves.toBeDefined();
  });
});

describe('findAfterCursor terminal page', () => {
  test('returns nextCursor null when the page is short', async () => {
    // Callers loop `while (nextCursor)`. A cursor on the last page costs an
    // extra empty round trip, and a do/while that trusts it never ends.
    mockDb.any.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const page = await makeModel().findAfterCursor({}, 10, ['id']);

    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  test('returns a cursor when the page is full', async () => {
    mockDb.any.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const page = await makeModel().findAfterCursor({}, 2, ['id']);

    expect(page.nextCursor).toEqual({ id: 'b' });
  });

  test('returns null for an empty page', async () => {
    mockDb.any.mockResolvedValue([]);
    const page = await makeModel().findAfterCursor({}, 10, ['id']);

    expect(page.nextCursor).toBeNull();
  });
});

describe('buildWhereClause soft-delete guard precedence', () => {
  test('parenthesizes an OR clause before appending the guard', () => {
    // AND binds tighter than OR, so `a OR b AND guard` is `a OR (b AND guard)`
    // — rows matching `a` come back deactivated. This is the documented public
    // builder; consumers using it to hand-roll a query were exposed.
    const { clause } = makeModel(softDeleteSchema).buildWhereClause(
      [{ label: 'x' }, { label: 'y' }],
      true,
      [],
      'OR'
    );

    expect(clause).toBe(
      '("label" = $1 OR "label" = $2) AND deactivated_at IS NULL'
    );
  });

  test('does not parenthesize when there is no guard to append', () => {
    const { clause } = makeModel().buildWhereClause(
      [{ label: 'x' }, { label: 'y' }],
      true,
      [],
      'OR'
    );

    expect(clause).toBe('"label" = $1 OR "label" = $2');
  });

  test('emits the bare guard when the clause is empty', () => {
    const { clause } = makeModel(softDeleteSchema).buildWhereClause({}, false);

    expect(clause).toBe('deactivated_at IS NULL');
  });

  test('omits the guard entirely when includeDeactivated is true', () => {
    const { clause } = makeModel(softDeleteSchema).buildWhereClause(
      [{ label: 'x' }, { label: 'y' }],
      true,
      [],
      'OR',
      true
    );

    expect(clause).toBe('"label" = $1 OR "label" = $2');
  });
});

describe('findOneBy', () => {
  test('queries with LIMIT 1', async () => {
    // It returns results[0] and discards the rest, so without a limit the
    // database scanned, serialized and transferred every matching row.
    // findWhere inlines the bound after validating it, so it is in the SQL
    // text rather than the value list.
    mockDb.any.mockResolvedValue([{ id: 'a' }]);
    await makeModel().findOneBy([{ label: 'x' }]);

    const sql = mockDb.any.mock.calls[0]![0] as string;
    expect(sql).toContain('LIMIT 1');
  });

  test('ignores a caller-supplied limit', async () => {
    mockDb.any.mockResolvedValue([{ id: 'a' }]);
    await makeModel().findOneBy([{ label: 'x' }], { limit: 50 });

    const sql = mockDb.any.mock.calls[0]![0] as string;
    expect(sql).toContain('LIMIT 1');
    expect(sql).not.toContain('LIMIT 50');
  });
});
