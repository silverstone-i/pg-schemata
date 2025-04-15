// ===============================
// tests/integration/BaseModel.integration.test.js
// ===============================

import { createTestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';

let ctx;

describe('BaseModel Integration', () => {
  beforeAll(async () => {
    ctx = await createTestContext(testUserSchema, null);
  });

  afterAll(async () => {
    //  await ctx.teardown();
  });

  test('insert and retrieve user', async () => {    
    const inserted = await ctx.model.insert({ email: 'test@example.com', created_by: 'Jill Lazarus' });
    const found = await ctx.model.findById(inserted.id);
    expect(found.email).toBe('test@example.com');
  });

  test('update user email', async () => {
    const user = await ctx.model.insert({ email: 'test@example.com', created_by: 'Jim Harbinger' });
    const updated = await ctx.model.update(user.id, { email: 'updated@example.com', updated_by: 'Jack Daniels' });
    expect(updated.email).toBe('updated@example.com');
  });

  test('delete user', async () => {
    const user = await ctx.model.insert({ email: 'delete@example.com', created_by: 'Jane Doe' });
    await ctx.model.delete(user.id);
    const shouldBeNull = await ctx.model.findById(user.id);
    expect(shouldBeNull).toBeNull();
  });
});
