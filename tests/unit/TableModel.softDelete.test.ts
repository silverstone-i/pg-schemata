/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import TableModel from '../../src/TableModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import type { IMain } from 'pg-promise';
import type { TableSchema } from '../../src/schemaTypes.js';

const mockDb: any = {
  result: vi.fn(),
};

const fakePgp = {
  as: { name: vi.fn(x => `"${x}"`) },
  helpers: { ColumnSet: vi.fn(() => ({})), update: vi.fn(() => 'UPDATE ...') },
} as unknown as IMain;

const schemaWithSoftDelete: TableSchema = {
  dbSchema: 'test_schema',
  table: 'test_users',
  softDelete: true,
  constraints: { primaryKey: ['id'] },
  columns: [
    { name: 'id', type: 'uuid' },
    { name: 'email', type: 'text' },
    { name: 'deactivated_at', type: 'timestamp' },
  ],
};

let model: any;

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

  test('removeWhere emits the soft-delete predicate exactly once (N9)', async () => {
    mockDb.result.mockResolvedValue({ rowCount: 1 });
    await model.removeWhere({ email: 'a@example.com' });
    const sql = mockDb.result.mock.calls[0][0];
    expect(sql.match(/deactivated_at IS NULL/g)).toHaveLength(1);
  });

  test('removeWhere rejects with SchemaDefinitionError (no status property) when soft delete is off', async () => {
    const noSoftDelete = new TableModel(mockDb, fakePgp, {
      ...schemaWithSoftDelete,
      softDelete: false,
    });

    let caught: unknown;
    try {
      await noSoftDelete.removeWhere({ email: 'a@example.com' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SchemaDefinitionError);
    expect((caught as Error).message).toBe(
      'Soft delete is not enabled for this table'
    );
    // The non-standard status: 403 REST-ism was removed in 2.0.0.
    expect('status' in (caught as object)).toBe(false);
  });

  test('deleteWhere emits the soft-delete predicate exactly once (N9)', async () => {
    mockDb.result.mockResolvedValue({ rowCount: 1 });
    await model.deleteWhere({ email: 'a@example.com' });
    const sql = mockDb.result.mock.calls[0][0];
    expect(sql.match(/deactivated_at IS NULL/g)).toHaveLength(1);
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
    const spy = vi
      .spyOn(model, 'purgeSoftDeleteWhere')
      .mockResolvedValue({ rowCount: 1 });
    await model.purgeSoftDeleteById('xyz');
    expect(spy).toHaveBeenCalledWith([{ id: 'xyz' }], { tx: undefined });
  });
});
