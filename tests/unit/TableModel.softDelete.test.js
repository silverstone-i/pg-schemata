import { describe, test, expect, vi, beforeEach } from 'vitest';
import TableModel from '../../src/TableModel.js';

const mockDb = {
  result: vi.fn()
};

const fakePgp = {
  as: { name: vi.fn(x => `"${x}"`) },
  helpers: { ColumnSet: vi.fn(() => ({})), update: vi.fn(() => 'UPDATE ...') }
};

const schemaWithSoftDelete = {
  dbSchema: 'test_schema',
  table: 'test_users',
  softDelete: true,
  constraints: { primaryKey: ['id'] },
  columns: [
    { name: 'id', type: 'uuid' },
    { name: 'email', type: 'text' },
    { name: 'deactivated_at', type: 'timestamp' }
  ]
};

let model;

beforeEach(() => {
  model = new TableModel(mockDb, fakePgp, schemaWithSoftDelete);
  mockDb.result.mockReset();
});

describe('TableModel soft delete unit tests', () => {
  test('removeWhere sets deactivated_at = NOW() and includes soft delete check', async () => {
    mockDb.result.mockResolvedValue({ rowCount: 2 });
    await model.removeWhere({ email: 'a@example.com' });
    const sql = mockDb.result.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE .* SET deactivated_at = NOW\(\)/);
    expect(sql).toMatch(/deactivated_at IS NULL/);
  });

  test('restoreWhere sets deactivated_at = NULL', async () => {
    mockDb.result.mockResolvedValue({ rowCount: 1 });
    await model.restoreWhere({ email: 'b@example.com' });
    const sql = mockDb.result.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE .* SET deactivated_at = NULL/);
  });

  test('purgeSoftDeleteWhere permanently deletes where deactivated_at IS NOT NULL', async () => {
    mockDb.result.mockResolvedValue({ rowCount: 3 });
    await model.purgeSoftDeleteWhere({ email: 'c@example.com' });
    const sql = mockDb.result.mock.calls[0][0];
    expect(sql).toContain('"deactivated_at" IS NOT NULL');
  });

  test('purgeSoftDeleteById constructs delete with id', async () => {
    const spy = vi.spyOn(model, 'purgeSoftDeleteWhere').mockResolvedValue({ rowCount: 1 });
    await model.purgeSoftDeleteById('xyz');
    expect(spy).toHaveBeenCalledWith([{ id: 'xyz' }]);
  });
});
