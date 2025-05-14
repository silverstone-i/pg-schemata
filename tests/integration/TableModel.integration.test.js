// ===============================
// tests/integration/TableModel.integration.test.js
// ===============================

import { createTestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';

let ctx, model, teardown, inserted;

describe('TableModel Integration', () => {
  beforeAll(async () => {
    ({ ctx, model, teardown } = await createTestContext(testUserSchema, null));
  });

  afterAll(async () => {
    await teardown();
  });

  test('insert and retrieve user', async () => {
    inserted = await model.insert({
      email: 'test@example.com',
      created_by: 'Jill Lazarus',
    });
    const found = await model.findById(inserted.id);
    expect(found.email).toBe('test@example.com');
  });

  test('update user email', async () => {
    const user = await model.insert({
      email: 'test@example.com',
      created_by: 'Jim Harbinger',
    });
    const updated = await model.update(user.id, {
      email: 'updated@example.com',
      updated_by: 'Jack Daniels',
    });
    expect(updated.email).toBe('updated@example.com');
  });

  test('delete user', async () => {
    const user = await model.insert({
      email: 'delete@example.com',
      created_by: 'Jane Doe',
    });
    await model.delete(user.id);
    const shouldBeNull = await model.findById(user.id);
    expect(shouldBeNull).toBeNull();
  });

  test('updateWhere should update multiple users', async () => {
    await model.insert({ email: 'a@test.com', created_by: 'updateWhere' });
    await model.insert({ email: 'b@test.com', created_by: 'updateWhere' });

    const count = await model.updateWhere(
      { $eq: { created_by: 'updateWhere' } },
      { updated_by: 'bulk-editor' }
    );

    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('deleteWhere should remove multiple users', async () => {
    await model.insert({ email: 'c@test.com', created_by: 'deleteWhere' });
    await model.insert({ email: 'd@test.com', created_by: 'deleteWhere' });

    const count = await model.deleteWhere({ created_by: 'deleteWhere' });
    expect(count).toBe(2);
  });

  test('bulkInsert should add multiple users at once', async () => {
    await model.bulkInsert([
      { email: 'bulk1@test.com', created_by: 'bulk' },
      { email: 'bulk2@test.com', created_by: 'bulk' },
    ]);

    const found = await model.findWhere([{ created_by: 'bulk' }]);
    expect(found.length).toBe(2);
  });

  test('bulkUpdate should modify multiple users in one call', async () => {
    const users = await Promise.all([
      model.insert({ email: 'bu1@test.com', created_by: 'bulk-update' }),
      model.insert({ email: 'bu2@test.com', created_by: 'bulk-update' }),
    ]);

    const updates = users.map(u => ({
      id: u.id,
      updated_by: 'updated-bulk',
      updated_at: new Date().toISOString(),
    }));

    await model.bulkUpdate(updates);

    const results = await model.findWhere([{ created_by: 'bulk-update' }]);
    expect(results.every(r => r.updated_by === 'updated-bulk')).toBe(true);
  });
});
