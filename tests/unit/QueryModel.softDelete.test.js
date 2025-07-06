import { describe, test, expect, vi, beforeEach } from 'vitest';
import QueryModel from '../../src/QueryModel.js';

const fakePgp = {
  as: {
    name: vi.fn(x => `"${x}"`)
  },
  helpers: {
    ColumnSet: vi.fn(() => ({}))
  }
};

const mockDb = {
  any: vi.fn(),
  one: vi.fn()
};

const schemaWithSoftDelete = {
  dbSchema: 'test_schema',
  table: 'test_users',
  softDelete: true,
  constraints: { primaryKey: ['id'] },
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'email', type: 'text' },
    { name: 'deactivated_at', type: 'timestamp' }
  ]
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
      includeDeactivated: true
    });

    const sql = mockDb.any.mock.calls[0][0];
    expect(sql).not.toMatch(/deactivated_at IS NULL/);
  });
});