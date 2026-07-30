import { describe, test, expect, vi, beforeEach } from 'vitest';
import QueryModel from '../../src/QueryModel.js';

const fakePgp = {
  as: {
    name: vi.fn(x => `"${x}"`),
  },
  helpers: {
    ColumnSet: vi.fn(() => ({})),
  },
};

const mockDb = {
  any: vi.fn(),
  one: vi.fn(),
};

const schemaWithSoftDelete = {
  dbSchema: 'test_schema',
  table: 'test_users',
  softDelete: true,
  constraints: { primaryKey: ['id'] },
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'email', type: 'text' },
    { name: 'deactivated_at', type: 'timestamp' },
  ],
};

let model;

beforeEach(() => {
  model = new QueryModel(mockDb, fakePgp, schemaWithSoftDelete);
  mockDb.any.mockReset();
  mockDb.one.mockReset();
});

describe('QueryModel - soft delete support', () => {
  test('findSoftDeleted should append deactivated_at IS NOT NULL', async () => {
    mockDb.any.mockResolvedValue([{ id: 1 }]);
    const result = await model.findSoftDeleted([{ email: 'test@example.com' }]);

    expect(mockDb.any).toHaveBeenCalled();
    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).toMatch(/"deactivated_at"\s+IS\s+NOT\s+NULL/);
    expect(result).toEqual([{ id: 1 }]);
  });

  test('isSoftDeleted returns true when row exists with deactivated_at IS NOT NULL', async () => {
    mockDb.one.mockResolvedValue({ exists: true });

    const result = await model.isSoftDeleted('abc-123');

    expect(mockDb.one).toHaveBeenCalled();
    const sql = mockDb.one.mock.calls[0][0];
    expect(sql).toMatch(/"deactivated_at"\s+IS\s+NOT\s+NULL/);
    expect(sql).toContain('"id" =');
    expect(result).toBe(true);
  });

  test('findWhere excludes soft-deleted rows by default', async () => {
    mockDb.any.mockResolvedValue([{ id: 2 }]);

    await model.findWhere([{ email: 'active@example.com' }]);

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).toMatch(/deactivated_at IS NULL/);
  });

  test('findWhere includes soft-deleted rows when includeDeactivated is true', async () => {
    mockDb.any.mockResolvedValue([{ id: 3 }]);

    await model.findWhere([{ email: 'any@example.com' }], 'AND', {
      includeDeactivated: true,
    });

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).not.toMatch(/deactivated_at IS NULL/);
  });

  test('public buildWhereClause includes the soft-delete guard (PR #10 review)', () => {
    const { clause } = model.buildWhereClause([{ email: 'x@example.com' }]);
    expect(clause).toMatch(/deactivated_at IS NULL/);

    const { clause: unguarded } = model.buildWhereClause(
      [{ email: 'x@example.com' }],
      true,
      [],
      'AND',
      true
    );
    expect(unguarded).not.toMatch(/deactivated_at IS NULL/);
  });

  test('findWhere emits the soft-delete predicate exactly once', async () => {
    mockDb.any.mockResolvedValue([]);

    await model.findWhere([{ email: 'x@example.com' }], 'AND', {
      filters: { id: 'abc' },
    });

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql.match(/deactivated_at IS NULL/g)).toHaveLength(1);
  });

  test('findWhere with only filters still excludes soft-deleted rows (issue 8)', async () => {
    mockDb.any.mockResolvedValue([]);

    // axerra's ViewController shape: no conditions, filters only.
    await model.findWhere([], 'AND', { filters: { email: 'x@example.com' } });

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).toMatch(/deactivated_at IS NULL/);
  });

  test('countWhere with only filters still excludes soft-deleted rows (issue 8)', async () => {
    mockDb.one.mockResolvedValue({ count: '0' });

    await model.countWhere([], 'AND', { filters: { email: 'x@example.com' } });

    const sql = mockDb.one.mock.calls[0][0];
    expect(sql).toMatch(/deactivated_at IS NULL/);
  });

  test('findAll guards without a dummy condition (issue 8)', async () => {
    mockDb.any.mockResolvedValue([]);

    await model.findAll();

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).toMatch(/WHERE deactivated_at IS NULL/);
    expect(sql).not.toContain('IS NOT NULL');
  });

  test('$max subquery excludes soft-deleted rows (issue 11)', async () => {
    mockDb.any.mockResolvedValue([]);

    await model.findWhere([{ id: { $max: true } }]);

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).toContain(
      '(SELECT MAX("id") FROM "test_schema"."test_users" WHERE deactivated_at IS NULL)'
    );
  });

  test('$max subquery includes soft-deleted rows when includeDeactivated is true (issue 11)', async () => {
    mockDb.any.mockResolvedValue([]);

    await model.findWhere([{ id: { $max: true } }], 'AND', {
      includeDeactivated: true,
    });

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).toContain('(SELECT MAX("id") FROM "test_schema"."test_users")');
  });

  test('reload excludes soft-deleted rows by default', async () => {
    mockDb.any.mockResolvedValue([]);

    await model.reload('abc-123');

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).toMatch(/deactivated_at IS NULL/);
  });

  test('reload honors includeDeactivated (issue 10)', async () => {
    mockDb.any.mockResolvedValue([{ id: 4 }]);

    const row = await model.reload('abc-123', { includeDeactivated: true });

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).not.toMatch(/deactivated_at IS NULL/);
    expect(row).toEqual({ id: 4 });
  });
});
