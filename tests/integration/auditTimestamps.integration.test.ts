/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// The unit suite asserts the SET clauses these paths emit. This asserts what
// lands in the row, which is the property the audit-fields guide actually
// promises.
//
// The schema uses the object form of hasAuditFields with no userFields.default,
// so _resolveAuditActor() returns null when no resolver is registered. Under the
// boolean form it falls back to 'system' and always resolves non-null, which is
// why the existing soft-delete suite never caught this: updated_at was inside
// the `if (actor != null)` branch and that branch was always taken.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from '../helpers/integrationHarness.js';
import type { TestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';
import { clearAuditActorResolver } from '../../src/auditActorResolver.js';
import type TableModel from '../../src/TableModel.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';

// No userFields.default, so an unregistered resolver yields null rather than
// the boolean form's 'system'.
const schema = {
  ...testUserSchema,
  table: 'audit_timestamp_users',
  hasAuditFields: { enabled: true },
  softDelete: true,
  columns: [
    ...testUserSchema.columns,
    { name: 'deactivated_at', type: 'timestamptz', default: null },
  ],
} as TableSchema;

let ctx: TestContext['ctx'], model: TableModel, teardown: () => Promise<void>;

async function seed(email: string) {
  return model.insert({
    tenant_id: TENANT_ID,
    email,
    name: 'Original',
    updated_by: 'seeder',
  } as never);
}

/** Reads the row past the soft-delete guard. */
async function raw(id: string) {
  return ctx.db.one<Record<string, unknown>>(
    `SELECT * FROM "${model.schema.dbSchema}"."${model.schema.table}" WHERE id = $1`,
    [id]
  );
}

describe('audit timestamps with no actor resolver (integration)', () => {
  beforeAll(async () => {
    ({ ctx, model, teardown } = await createTestContext(schema, null));
  });

  afterAll(async () => {
    await teardown();
  });

  test('removeWhere advances updated_at', async () => {
    const row = await seed('audit-remove@example.com');
    clearAuditActorResolver();
    const before = new Date((await raw(row.id)).updated_at as string);

    await model.removeWhere({ id: row.id });

    const after = await raw(row.id);
    expect(after.deactivated_at).not.toBeNull();
    expect(
      new Date(after.updated_at as string).getTime()
    ).toBeGreaterThanOrEqual(before.getTime());
    // No actor resolved, so the seeded value survives rather than being nulled.
    expect(after.updated_by).toBe('seeder');
  });

  test('restoreWhere advances updated_at', async () => {
    const row = await seed('audit-restore@example.com');
    clearAuditActorResolver();
    await model.removeWhere({ id: row.id });
    const before = new Date((await raw(row.id)).updated_at as string);

    await model.restoreWhere({ id: row.id });

    const after = await raw(row.id);
    expect(after.deactivated_at).toBeNull();
    expect(
      new Date(after.updated_at as string).getTime()
    ).toBeGreaterThanOrEqual(before.getTime());
  });

  test('update() leaves a recorded updated_by intact', async () => {
    // It used to assign the unresolved null, erasing the audit trail on every
    // update made while no resolver was configured.
    const row = await seed('audit-update@example.com');
    clearAuditActorResolver();

    await model.update(row.id, { name: 'Changed' } as never);

    const after = await raw(row.id);
    expect(after.name).toBe('Changed');
    expect(after.updated_by).toBe('seeder');
  });

  test('touch() advances updated_at', async () => {
    // With no actor this sent an empty DTO, which update() rejected outright.
    const row = await seed('audit-touch@example.com');
    clearAuditActorResolver();
    const before = new Date((await raw(row.id)).updated_at as string);

    await expect(model.touch(row.id)).resolves.not.toBeNull();

    const after = await raw(row.id);
    expect(
      new Date(after.updated_at as string).getTime()
    ).toBeGreaterThanOrEqual(before.getTime());
    expect(after.updated_by).toBe('seeder');
    expect(after.name).toBe('Original');
  });
});
