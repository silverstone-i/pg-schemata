/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// ===============================
// tests/integration/TableModel.partialUpdate.integration.test.ts
// ===============================
//
// update() and touch() had no real-Postgres coverage at all, which is how a
// data-loss bug in the most-used write path survived 1.2.2, 2.0.0 and into
// 3.0.0: update() passed the cached `cs.update` to pg-promise, so every column
// the DTO omitted was written as null or its declared SQL default.
//
// The unit suite asserts the generated SQL text, which would still pass if
// pg-promise or Postgres disagreed with that reading. These tests assert what
// actually survives in a row, which is the property callers depend on.

import { createTestContext } from '../helpers/integrationHarness.js';
import type { TestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';
import type TableModel from '../../src/TableModel.js';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';

let ctx: TestContext['ctx'], model: TableModel, teardown: () => Promise<void>;

/** A row with every column populated, so any loss is visible. */
async function seedRow(email: string) {
  return model.insert({
    tenant_id: TENANT_ID,
    email,
    name: 'Original Name',
    status: 'active',
    notes: 'original notes',
    is_active: false, // deliberately not the column default of true
    created_by: 'partial-update-tester',
  });
}

describe('TableModel partial update integration', () => {
  beforeAll(async () => {
    ({ ctx, model, teardown } = await createTestContext(testUserSchema, null));
  });

  afterAll(async () => {
    await teardown();
  });

  test('update() leaves every column the DTO omits untouched', async () => {
    const inserted = await seedRow('partial-update-1@example.com');

    const returned = await model.update(inserted.id, { name: 'Changed Name' });

    // RETURNING * still comes back whole.
    expect(returned).not.toBeNull();
    expect(returned!.name).toBe('Changed Name');

    const row = await model.findById(inserted.id);
    expect(row).not.toBeNull();

    expect(row!.name).toBe('Changed Name');
    // Each of these was overwritten before the fix:
    //   notNull without a default -> null (rejected by the DB, or worse, allowed)
    //   nullable with a value     -> null, silently
    //   declared SQL default      -> reset to the default, silently
    expect(row!.tenant_id).toBe(TENANT_ID);
    expect(row!.email).toBe('partial-update-1@example.com');
    expect(row!.status).toBe('active');
    expect(row!.notes).toBe('original notes');
    expect(row!.is_active).toBe(false);
  });

  test('update() does not reset a column that declares a SQL default', async () => {
    // is_active defaults to true. The old ColumnSet emitted `is_active=DEFAULT`
    // for any DTO that omitted it, flipping a deliberate false back to true —
    // a silent change no NOT NULL constraint would have caught.
    const inserted = await seedRow('partial-update-2@example.com');
    expect(inserted.is_active).toBe(false);

    await model.update(inserted.id, { notes: 'only notes changed' });

    const row = await model.findById(inserted.id);
    expect(row!.is_active).toBe(false);
    expect(row!.notes).toBe('only notes changed');
  });

  test('update() advances updated_at', async () => {
    const inserted = await seedRow('partial-update-3@example.com');
    const before = new Date(inserted.updated_at as string);

    await model.update(inserted.id, { name: 'Bumped' });

    const row = await model.findById(inserted.id);
    const after = new Date(row!.updated_at as string);
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  test('update() ignores a caller-supplied updated_at', async () => {
    // The column is emitted with pg-promise's raw modifier, so a Date in the
    // DTO used to be inlined unquoted and produce invalid SQL. With audit
    // fields enabled the library owns the column.
    const inserted = await seedRow('partial-update-4@example.com');

    await model.update(inserted.id, {
      name: 'Backdate attempt',
      updated_at: new Date(0),
    } as never);

    const row = await model.findById(inserted.id);
    expect(row!.name).toBe('Backdate attempt');
    expect(
      new Date(row!.updated_at as string).getUTCFullYear()
    ).toBeGreaterThan(1970);
  });

  test('touch() changes nothing but the audit columns', async () => {
    // touch() routes through update() with only updated_by, which under the old
    // ColumnSet rewrote the entire row.
    const inserted = await seedRow('partial-update-5@example.com');

    await model.touch(inserted.id, 'toucher');

    const row = await model.findById(inserted.id);
    expect(row!.tenant_id).toBe(TENANT_ID);
    expect(row!.email).toBe('partial-update-5@example.com');
    expect(row!.name).toBe('Original Name');
    expect(row!.status).toBe('active');
    expect(row!.notes).toBe('original notes');
    expect(row!.is_active).toBe(false);
    expect(row!.updated_by).toBe('toucher');
  });

  test('update() still writes every column a full DTO supplies', async () => {
    // The converse: narrowing the ColumnSet must not start dropping values.
    const inserted = await seedRow('partial-update-6@example.com');

    await model.update(inserted.id, {
      name: 'All New',
      status: 'archived',
      notes: 'all new notes',
      is_active: true,
    });

    const row = await model.findById(inserted.id);
    expect(row!.name).toBe('All New');
    expect(row!.status).toBe('archived');
    expect(row!.notes).toBe('all new notes');
    expect(row!.is_active).toBe(true);
    expect(row!.email).toBe('partial-update-6@example.com');
  });

  test('update() returns null for an id that does not exist', async () => {
    const missing = await model.update('99999999-8888-4777-8666-555555555555', {
      name: 'nobody',
    });
    expect(missing).toBeNull();
  });
});
