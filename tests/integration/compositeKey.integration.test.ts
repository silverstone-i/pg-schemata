/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// The unit suite asserts the SQL these paths emit. This asserts which row the
// database actually changes, which is the property that was wrong: a composite
// key produced a correct PRIMARY KEY constraint and then every by-id method
// matched on `id` alone. On a table with no `id` column that was a hard error;
// on one that had both, it silently hit the wrong row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from '../helpers/integrationHarness.js';
import type { TestContext } from '../helpers/integrationHarness.js';
import type TableModel from '../../src/TableModel.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const TENANT_A = '11111111-2222-4333-8444-555555555555';
const TENANT_B = '22222222-3333-4444-8555-666666666666';
const USER = '99999999-8888-4777-8666-555555555555';

// No `id` column at all, so any residual reference to one fails loudly.
const membershipSchema: TableSchema = {
  dbSchema: 'test_schema',
  table: 'memberships',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'tenant_id', type: 'uuid', notNull: true },
    { name: 'user_id', type: 'uuid', notNull: true },
    { name: 'role', type: 'text', notNull: true, default: "'member'" },
    { name: 'note', type: 'text' },
  ],
  constraints: { primaryKey: ['tenant_id', 'user_id'] },
};

let ctx: TestContext['ctx'], model: TableModel, teardown: () => Promise<void>;

describe('composite primary key (integration)', () => {
  beforeAll(async () => {
    ({ ctx, model, teardown } = await createTestContext(
      membershipSchema,
      null
    ));
  });

  afterAll(async () => {
    await teardown();
  });

  it('creates the composite constraint', async () => {
    const cols = await ctx.db.any<{ column_name: string }>(
      `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1 AND tc.table_name = 'memberships'
        ORDER BY kcu.ordinal_position`,
      [model.schema.dbSchema]
    );
    expect(cols.map(c => c.column_name)).toEqual(['tenant_id', 'user_id']);
  });

  it('targets exactly one row across findById, update and delete', async () => {
    // Same user_id in two tenants: only the full key distinguishes them.
    await model.insert({
      tenant_id: TENANT_A,
      user_id: USER,
      role: 'admin',
      note: 'a',
    } as never);
    await model.insert({
      tenant_id: TENANT_B,
      user_id: USER,
      role: 'member',
      note: 'b',
    } as never);

    const found = await model.findById({
      tenant_id: TENANT_A,
      user_id: USER,
    });
    expect(found).not.toBeNull();
    expect(found!.role).toBe('admin');
    expect(found!.note).toBe('a');

    await model.update({ tenant_id: TENANT_A, user_id: USER }, {
      note: 'updated',
    } as never);

    // The other tenant's row is untouched — the assertion that fails if the
    // key is only half applied.
    const other = await model.findById({ tenant_id: TENANT_B, user_id: USER });
    expect(other!.note).toBe('b');
    expect(other!.role).toBe('member');

    const deleted = await model.delete({
      tenant_id: TENANT_A,
      user_id: USER,
    });
    expect(deleted).toBe(1);
    expect(
      await model.findById({ tenant_id: TENANT_A, user_id: USER })
    ).toBeNull();
    expect(
      await model.findById({ tenant_id: TENANT_B, user_id: USER })
    ).not.toBeNull();
  });

  it('bulkUpdate keys each record on both columns', async () => {
    await model.insert({
      tenant_id: TENANT_A,
      user_id: USER,
      role: 'admin',
      note: 'bulk-a',
    } as never);

    await model.bulkUpdate([
      { tenant_id: TENANT_A, user_id: USER, note: 'bulk-a-changed' },
    ] as never);

    const a = await model.findById({ tenant_id: TENANT_A, user_id: USER });
    const b = await model.findById({ tenant_id: TENANT_B, user_id: USER });
    expect(a!.note).toBe('bulk-a-changed');
    expect(b!.note).toBe('b');
  });

  it('rejects a scalar key at call time', async () => {
    await expect(model.findById(USER)).rejects.toThrow(/composite primary key/);
  });
});
