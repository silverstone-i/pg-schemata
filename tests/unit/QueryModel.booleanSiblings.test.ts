/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// An object carrying $and or $or used to `continue` past its own column keys,
// so every sibling predicate was silently discarded:
//
//   { $and: [...], tenant_id: TENANT }  ->  WHERE (...)
//
// FiltersInput permits that shape, so TypeScript did not flag it, and the
// emitted SQL is valid — it just matches more rows than asked for. Where the
// dropped predicate is a tenancy or authorization filter, that is a data
// disclosure rather than a wrong result.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import QueryModel from '../../src/QueryModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { IMain } from 'pg-promise';
import type { DbConnection, TableSchema } from '../../src/schemaTypes.js';

const fakePgp = {
  as: { name: vi.fn((x: string) => `"${x}"`), format: vi.fn((q: string) => q) },
  helpers: { ColumnSet: vi.fn(() => ({})) },
};
const mockDb = { any: vi.fn(), one: vi.fn() };

const schema: TableSchema = {
  dbSchema: 'public',
  table: 'members',
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'tenant_id', type: 'uuid', notNull: true },
    { name: 'role', type: 'text' },
    { name: 'is_active', type: 'boolean' },
  ],
  constraints: { primaryKey: ['id'] },
};

let model: QueryModel;

beforeEach(() => {
  columnSetCache.clear();
  model = new QueryModel(
    mockDb as unknown as DbConnection,
    fakePgp as unknown as IMain,
    schema
  );
});

describe('boolean groups keep their sibling predicates', () => {
  it('emits both the $or group and a sibling column', () => {
    const values: unknown[] = [];
    const clause = model.buildCondition(
      [
        { $or: [{ role: 'admin' }, { role: 'owner' }], tenant_id: 'T1' },
      ] as never,
      'AND',
      values
    );

    expect(clause).toBe('("role" = $1 OR "role" = $2) AND "tenant_id" = $3');
    expect(values).toEqual(['admin', 'owner', 'T1']);
  });

  it('emits both the $and group and a sibling column', () => {
    const values: unknown[] = [];
    const clause = model.buildCondition(
      [
        {
          $and: [{ role: 'user' }, { is_active: true }],
          tenant_id: 'T1',
        },
      ] as never,
      'AND',
      values
    );

    expect(clause).toBe(
      '("role" = $1 AND "is_active" = $2) AND "tenant_id" = $3'
    );
    expect(values).toEqual(['user', true, 'T1']);
  });

  it('handles $and and $or on the same object alongside a sibling', () => {
    const values: unknown[] = [];
    const clause = model.buildCondition(
      [
        {
          $and: [{ is_active: true }],
          $or: [{ role: 'admin' }, { role: 'owner' }],
          tenant_id: 'T1',
        },
      ] as never,
      'AND',
      values
    );

    expect(clause).toBe(
      '("is_active" = $1) AND ("role" = $2 OR "role" = $3) AND "tenant_id" = $4'
    );
  });

  it('joins siblings with the outer joiner, as two plain keys always did', () => {
    const values: unknown[] = [];
    const clause = model.buildCondition(
      [{ $or: [{ role: 'admin' }], tenant_id: 'T1' }] as never,
      'OR',
      values
    );

    expect(clause).toBe('("role" = $1) OR "tenant_id" = $2');
  });

  it('leaves a lone boolean group unchanged', () => {
    const values: unknown[] = [];
    const clause = model.buildCondition(
      [{ $or: [{ role: 'admin' }, { role: 'owner' }] }] as never,
      'AND',
      values
    );

    expect(clause).toBe('("role" = $1 OR "role" = $2)');
  });

  it('ignores an empty boolean group rather than treating it as a column', () => {
    // The old guard required a non-empty array, so `$or: []` fell through to
    // the field loop and emitted a predicate against a column named "$or".
    const values: unknown[] = [];
    const clause = model.buildCondition(
      [{ $or: [], tenant_id: 'T1' }] as never,
      'AND',
      values
    );

    expect(clause).toBe('"tenant_id" = $1');
    expect(clause).not.toContain('$or');
  });

  it('carries through findWhere', () => {
    mockDb.any.mockResolvedValue([]);
    return model
      .findWhere([
        { $or: [{ role: 'admin' }, { role: 'owner' }], tenant_id: 'T1' },
      ] as never)
      .then(() => {
        const sql = mockDb.any.mock.calls[0]![0] as string;
        expect(sql).toContain('"tenant_id" = $3');
      });
  });
});
