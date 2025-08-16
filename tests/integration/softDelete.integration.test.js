import { createTestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';

const softDeleteSchema = {
  ...testUserSchema,
  softDelete: true,
  columns: [...testUserSchema.columns, { name: 'deactivated_at', type: 'timestamp', default: null }],
};

let ctx, model, teardown;

describe('Soft delete integration tests', () => {
  beforeAll(async () => {
    ({ ctx, model, teardown } = await createTestContext(softDeleteSchema));
  });

  afterAll(async () => {
    await teardown();
  });

  test('record is soft deleted and excluded from default findWhere()', async () => {
    const row = await model.insert({
      email: 'soft1@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    await model.removeWhere({ id: row.id });

    const found = await model.findWhere([{ id: row.id }]);
    expect(found).toEqual([]);
  });

  test('record is included in findWhere with includeDeactivated', async () => {
    const row = await model.insert({
      email: 'soft2@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    await model.removeWhere({ id: row.id });

    const found = await model.findWhere([{ id: row.id }], 'AND', { includeDeactivated: true });
    expect(found.length).toBe(1);
    expect(found[0].deactivated_at).not.toBeNull();
  });

  test('record is restored by restoreWhere()', async () => {
    const row = await model.insert({
      email: 'restore@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    await model.removeWhere({ id: row.id });
    await model.restoreWhere({ id: row.id });

    const found = await model.findWhere([{ id: row.id }]);
    expect(found.length).toBe(1);
    expect(found[0].deactivated_at).toBeNull();
  });

  test('record is purged from db by purgeSoftDeleteWhere()', async () => {
    const row = await model.insert({
      email: 'purge@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    await model.removeWhere({ id: row.id });
    await new Promise(resolve => setTimeout(resolve, 10));
    const deleted = await model.findWhere([{ id: row.id }], 'AND', { includeDeactivated: true });
    expect(deleted.length).toBe(1);
    expect(deleted[0].deactivated_at).not.toBeNull();
    const purged = await model.purgeSoftDeleteWhere({ id: row.id });

    expect(purged.rowCount).toBe(1);
    const found = await model.findWhere([{ id: row.id }], 'AND', { includeDeactivated: true });
    expect(found).toEqual([]);
  });

  test('calling removeWhere twice is idempotent', async () => {
    const row = await model.insert({
      email: 'double@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    await model.removeWhere({ id: row.id });
    const first = await model.findWhere([{ id: row.id }], 'AND', { includeDeactivated: true });
    expect(first[0].deactivated_at).not.toBeNull();

    await model.removeWhere({ id: row.id });
    const second = await model.findWhere([{ id: row.id }], 'AND', { includeDeactivated: true });
    expect(second[0].deactivated_at).toEqual(first[0].deactivated_at);
  });

  test('calling restoreWhere on active record does nothing', async () => {
    const row = await model.insert({
      email: 'noop@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    const restored = await model.restoreWhere({ id: row.id });
    expect(restored?.rowCount ?? 0).toBe(0);

    const found = await model.findWhere([{ id: row.id }]);
    expect(found.length).toBe(1);
    expect(found[0].deactivated_at).toBeNull();
  });

  test('purgeSoftDeleteWhere does not delete active record', async () => {
    const row = await model.insert({
      email: 'safe@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    const purged = await model.purgeSoftDeleteWhere({ id: row.id });
    expect(purged.rowCount).toBe(0);

    const found = await model.findWhere([{ id: row.id }]);
    expect(found.length).toBe(1);
  });

  test('removeWhere applies additional filters correctly', async () => {
    const row1 = await model.insert({
      email: 'multi1@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    const row2 = await model.insert({
      email: 'multi2@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    await model.removeWhere({ email: 'multi1@example.com', tenant_id: TENANT_ID });

    const all = await model.findWhere([], 'AND', { includeDeactivated: true });
    const softDeleted = all.find(r => r.email === 'multi1@example.com');
    const stillActive = all.find(r => r.email === 'multi2@example.com');

    expect(softDeleted.deactivated_at).not.toBeNull();
    expect(stillActive.deactivated_at).toBeNull();
  });

  test('removeWhere supports deleting multiple rows', async () => {
    const row1 = await model.insert({
      email: 'bulk1@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    const row2 = await model.insert({
      email: 'bulk2@example.com',
      tenant_id: TENANT_ID,
      created_by: 'soft-tester',
    });

    await model.removeWhere({ tenant_id: TENANT_ID });

    const all = await model.findWhere([], 'AND', { includeDeactivated: true });
    expect(all.filter(r => r.deactivated_at !== null).length).toBeGreaterThanOrEqual(2);
  });
});
