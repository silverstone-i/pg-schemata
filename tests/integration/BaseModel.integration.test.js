// ===============================
// tests/integration/BaseModel.integration.test.js
// ===============================

import { createTestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';

let ctx, model, teardown, inserted;

describe('BaseModel Integration', () => {
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

  test('should find a record by id', async () => {
    const found = await model.findById(inserted.id);

    expect(found).toMatchObject(inserted);
  });

  test('should return all records with limit and offset', async () => {
    const result = await model.findAll({ limit: 10, offset: 0 });
    expect(Array.isArray(result)).toBe(true);
  });

  test('should support findBy with conditions', async () => {
    const result = await model.findBy(
      [{ email: 'test@example.com' }, { email: 'updated@example.com' }],
      'OR'
    );
    expect(result.length).toBeGreaterThan(0);
  });

  test('should check existence of record', async () => {
    const exists = await model.exists({ email: 'updated@example.com' });
    expect(exists).toBe(true);
  });

  test('should reload a record by id', async () => {
    const reloaded = await model.reload(inserted.id);
    expect(reloaded.email).toBe('test@example.com');
  });

  test('should return false for non-existing record in exists()', async () => {
    const exists = await model.exists({ email: 'nonexistent@test.com' });
    expect(exists).toBe(false);
  });

  test('should throw error for invalid findAfterCursor input', async () => {
    await expect(model.findAfterCursor('not-an-id')).rejects.toThrow();
  });

  test('should log and rethrow database errors', async () => {
    const mockLogger = { error: jest.fn() };
    model.logger = mockLogger;

    const error = new Error('Fake DB Error');
    expect(() => model.handleDbError(error)).toThrow('Fake DB Error');
    expect(mockLogger.error).toHaveBeenCalledWith('Database error:', error);
  });

  test('should support findAfterCursor with descending and columnWhitelist options', async () => {
    const a = await model.insert({ email: 'z@example.com', created_by: 'System' });
    const b = await model.insert({ email: 'y@example.com', created_by: 'System' });
    const c = await model.insert({ email: 'x@example.com', created_by: 'System' });

    const rows = await model.findAfterCursor(
      { created_at: b.created_at, id: b.id },
      10,
      ['created_at', 'id'],
      {
        descending: true,
        columnWhitelist: ['email'],
      }
    );

    expect(rows).toBeDefined();
    expect(Array.isArray(rows.rows)).toBe(true);
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows.rows[0])).toEqual(['email']);
  });

  test('should support findBy with filters using AND and ILIKE', async () => {
    await model.insert({ email: 'findbyuser1@example.com', created_by: 'Admin' });
    await model.insert({ email: 'findbyuser2@example.com', created_by: 'Admin' });

    const result = await model.findBy([{ created_by: 'Admin' }], 'AND', {
      filters: {
        and: [{ email: { ilike: '%findbyuser%' } }],
      },
    });

    expect(result.length).toBeGreaterThan(0);
    result.forEach(row => {
      expect(row.email).toMatch(/findbyuser/);
    });
  });

  test('should support findOneBy returning a single row', async () => {
    const user = await model.insert({ email: 'findoneby@example.com', created_by: 'UnitTest' });
    const found = await model.findOneBy([{ email: 'findoneby@example.com' }]);

    expect(found).toBeDefined();
    expect(found.email).toBe('findoneby@example.com');
  });

  test('should return null in findOneBy if no match is found', async () => {
    const found = await model.findOneBy([{ email: 'missinguser@example.com' }]);
    expect(found).toBeNull();
  });
});
