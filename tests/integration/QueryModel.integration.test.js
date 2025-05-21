import { createTestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

let ctx, model, teardown, inserted;

describe('QueryModel Integration', () => {
  beforeAll(async () => {
    ({ ctx, model, teardown } = await createTestContext(testUserSchema, null));
    inserted = await model.insert({
      email: 'test@example.com',
      created_by: 'Jill Lazarus',
      tenant_id: TENANT_ID,
    });
  });

  afterAll(async () => {
    await teardown();
  });

  test('should find a record by id', async () => {
    const found = await model.findById(inserted.id);
    expect(found).toMatchObject(inserted);
  });

  test('should return all records with limit and offset', async () => {
    const result = await model.findAll({ limit: 10, offset: 0 });
    expect(Array.isArray(result)).toBe(true);
  });

  test('should support findWhere with conditions', async () => {
    await model.insert({
      email: 'findwhere-1@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'findwhere-2@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });

    const result = await model.findWhere(
      [
        { email: 'findwhere-1@example.com' },
        { email: 'findwhere-2@example.com' },
      ],
      'OR'
    );
    expect(result.length).toBe(2);
  });

  test('should check existence of record', async () => {
    const exists = await model.exists({ email: 'test@example.com' });
    expect(exists).toBe(true);
  });

  test('should return false for non-existing record in exists()', async () => {
    const exists = await model.exists({ email: 'nonexistent@test.com' });
    expect(exists).toBe(false);
  });

  test('should return correct count for filtered records', async () => {
    const count = await model.count({ email: 'test@example.com' });
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThan(0);
  });

  test('should return 0 for unmatched filter in count()', async () => {
    const count = await model.count({ email: 'doesnotexist@example.com' });
    expect(count).toBe(0);
  });

  test('should return correct count using $ilike operator in count()', async () => {
    await model.insert({
      email: 'countilike1@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });

    const count = await model.count([
      {
        email: { $ilike: '%countilike1%' },
      },
    ]);

    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('should return correct count using nested $or condition in count()', async () => {
    await model.insert({ email: 'orcount1@example.com', created_by: 'X', tenant_id: TENANT_ID });
    await model.insert({ email: 'orcount2@example.com', created_by: 'Y', tenant_id: TENANT_ID });

    const count = await model.count(
      [{'$or': [{ created_by: 'X' }, { created_by: 'Y' }]}],
);

    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('should reload a record by id', async () => {
    const reloaded = await model.reload(inserted.id);
    expect(reloaded.email).toBe('test@example.com');
  });

  test('should support findAfterCursor with descending and columnWhitelist options', async () => {
    const a = await model.insert({
      email: 'z@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });
    const b = await model.insert({
      email: 'y@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });
    await model.insert({ email: 'x@example.com', created_by: 'System', tenant_id: TENANT_ID });

    const rows = await model.findAfterCursor(
      { created_at: b.created_at, id: b.id },
      10,
      ['created_at', 'id'],
      {
        descending: true,
        columnWhitelist: ['email'],
      }
    );

    expect(Array.isArray(rows.rows)).toBe(true);
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows.rows[0])).toEqual(['email']);
  });

  test('should throw error for invalid findAfterCursor input', async () => {
    await expect(model.findAfterCursor('not-an-id')).rejects.toThrow();
  });

  test('should support findWhere with filters using AND and ILIKE', async () => {
    await model.insert({
      email: 'findbyuser1@example.com',
      created_by: 'Admin',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'findbyuser2@example.com',
      created_by: 'Admin',
      tenant_id: TENANT_ID,
    });

    const result = await model.findWhere([{ created_by: 'Admin' }], 'AND', {
      filters: {
        $and: [{ email: { $ilike: '%findbyuser%' } }],
      },
    });

    expect(result.length).toBeGreaterThan(0);
    result.forEach(row => {
      expect(row.email).toMatch(/findbyuser/);
    });
  });

  test('should support findOneBy returning a single row', async () => {
    await model.insert({
      email: 'findoneby@example.com',
      created_by: 'UnitTest',
      tenant_id: TENANT_ID,
    });
    const found = await model.findOneBy([{ email: 'findoneby@example.com' }]);
    expect(found).toBeDefined();
    expect(found.email).toBe('findoneby@example.com');
  });

  test('should return null in findOneBy if no match is found', async () => {
    const found = await model.findOneBy([{ email: 'missinguser@example.com' }]);
    expect(found).toBeNull();
  });

  test('should log and rethrow database errors', async () => {
    const mockLogger = { error: jest.fn() };
    model.logger = mockLogger;
    const error = new Error('Database operation failed');
    expect(() => model.handleDbError(error)).toThrow('Database operation failed');
    expect(mockLogger.error).toHaveBeenCalledWith('Database error:', error);
  });

  test('should throw on empty condition array in findWhere', async () => {
    await expect(model.findWhere([])).rejects.toThrow(
      'Conditions must be a non-empty array'
    );
  });

  test('should throw on unsupported operator in findWhere', async () => {
    await expect(
      model.findWhere([{ email: { likee: 'bad' } }])
    ).rejects.toThrow('Unsupported operator: likee');
  });

  test('should support nested OR and AND conditions in findWhere', async () => {
    await model.insert({ email: 'nested1@example.com', created_by: 'Admin', tenant_id: TENANT_ID });
    await model.insert({ email: 'nested2@example.com', created_by: 'System', tenant_id: TENANT_ID });

    const result = await model.findWhere([
      { $or: [{ created_by: 'Admin' }, { created_by: 'System' }] },
      { email: { $ilike: '%nested%' } },
    ]);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test('should support exists with multiple conditions', async () => {
    const exists = await model.exists({
      email: 'test@example.com',
      created_by: 'Jill Lazarus',
    });
    expect(exists).toBe(true);
  });

  test('should return single record in findOneBy with multiple matches', async () => {
    await model.insert({ email: 'dupe@example.com', created_by: 'X', tenant_id: TENANT_ID });
    await model.insert({ email: 'dupe@example.com', created_by: 'Y', tenant_id: TENANT_ID });
    const one = await model.findOneBy([{ email: 'dupe@example.com' }]);
    expect(one).toBeDefined();
    expect(one.email).toBe('dupe@example.com');
  });
  test('should return single result for duplicate OR conditions', async () => {
    await model.insert({
      email: 'redundant@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });

    const result = await model.findWhere(
      [{ email: 'redundant@example.com' }, { email: 'redundant@example.com' }],
      'OR'
    );
    expect(result.length).toBe(1);
    expect(result[0].email).toBe('redundant@example.com');
  });

  test('should return no results for conflicting AND conditions', async () => {
    await model.insert({
      email: 'conflict@example.com',
      created_by: 'TestUser',
      tenant_id: TENANT_ID,
    });

    const result = await model.findWhere(
      [{ email: 'conflict@example.com' }, { email: 'notfound@example.com' }],
      'AND'
    );
    expect(result.length).toBe(0);
  });

  test('should handle empty OR group gracefully', async () => {
    await model.insert({ email: 'emptyor@example.com', created_by: 'Admin', tenant_id: TENANT_ID });

    // Intentionally include an empty OR group
    const result = await model.findWhere([
      { $or: [] },
      { email: 'emptyor@example.com' },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].email).toBe('emptyor@example.com');
  });

  test('should support nested AND inside OR conditions', async () => {
    await model.insert({ email: 'x@example.com', created_by: 'A', tenant_id: TENANT_ID });
    await model.insert({ email: 'y@example.com', created_by: 'B', tenant_id: TENANT_ID });

    const result = await model.findWhere([
      {
        $or: [
          { $and: [{ created_by: 'A' }, { email: 'x@example.com' }] },
          { $and: [{ created_by: 'B' }, { email: 'y@example.com' }] },
        ],
      },
    ]);
    expect(result.length).toBe(2);
  });

  test('should support null values in where clause', async () => {
    await model.insert({
      email: 'nulltest@example.com',
      created_by: 'Test',
      notes: null,
      tenant_id: TENANT_ID,
    });
    const result = await model.findWhere([
      { email: 'nulltest@example.com' },
      { notes: null },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].email).toBe('nulltest@example.com');
  });

  test('should distinguish case-sensitive values unless ILIKE is used', async () => {
    await model.insert({
      email: 'CaseSensitive@Example.com',
      created_by: 'CaseTest',
      tenant_id: TENANT_ID,
    });

    const resultExact = await model.findWhere([
      { email: 'casesensitive@example.com' },
    ]);
    expect(resultExact.length).toBe(0);

    const resultIlike = await model.findWhere([
      { email: { $ilike: 'casesensitive@example.com' } },
    ]);
    expect(resultIlike.length).toBe(1);
    expect(resultIlike[0].email).toBe('CaseSensitive@Example.com');
  });

  test('should support multiple levels of nested OR/AND', async () => {
    await model.insert({ email: 'nesteddeep1@example.com', created_by: 'A', tenant_id: TENANT_ID });
    await model.insert({ email: 'nesteddeep2@example.com', created_by: 'B', tenant_id: TENANT_ID });

    const result = await model.findWhere([
      {
        $or: [
          {
            $and: [
              { $or: [{ created_by: 'A' }] },
              { email: 'nesteddeep1@example.com' },
            ],
          },
          {
            $and: [
              { $or: [{ created_by: 'B' }] },
              { email: 'nesteddeep2@example.com' },
            ],
          },
        ],
      },
    ]);
    expect(result.length).toBe(2);
  });

  test('should support range with from and to syntax', async () => {
    const early = await model.insert({
      email: 'range1@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });
    const late = await model.insert({
      email: 'range2@example.com',
      created_by: 'System',
      tenant_id: TENANT_ID,
    });

    const result = await model.findWhere([
      {
        created_at: {
          $from: early.created_at,
          $to: new Date(new Date(late.created_at).getTime() + 1000),
        },
      },
    ]);

    expect(result.length).toBeGreaterThanOrEqual(2);
    const emails = result.map(r => r.email);
    expect(emails).toContain('range1@example.com');
    expect(emails).toContain('range2@example.com');
  });

  test('should support IN clause via array of values', async () => {
    await model.insert({ email: 'in1@example.com', created_by: 'User', tenant_id: TENANT_ID });
    await model.insert({ email: 'in2@example.com', created_by: 'User', tenant_id: TENANT_ID });

    const result = await model.findWhere([
      { email: { $in: ['in1@example.com', 'in2@example.com'] } },
    ]);

    const emails = result.map(r => r.email);
    expect(emails).toContain('in1@example.com');
    expect(emails).toContain('in2@example.com');
  });

  test('should support boolean conditions if present in schema', async () => {
    // This will only pass if a boolean field like `is_active` is present in test schema
    const activeUser = await model.insert({
      email: 'bool1@example.com',
      created_by: 'Tester',
      is_active: true,
      tenant_id: TENANT_ID,
    });
    const inactiveUser = await model.insert({
      email: 'bool2@example.com',
      created_by: 'Tester',
      is_active: false,
      tenant_id: TENANT_ID,
    });

    const result = await model.findWhere([{ is_active: true }]);
    expect(result.find(r => r.email === 'bool1@example.com')).toBeDefined();
    expect(result.find(r => r.email === 'bool2@example.com')).toBeUndefined();
  });

  test('should find multiple records by id using $in syntax', async () => {
    const user1 = await model.insert({
      email: 'multiin1@example.com',
      created_by: 'MultiTest',
      tenant_id: TENANT_ID,
    });
    const user2 = await model.insert({
      email: 'multiin2@example.com',
      created_by: 'MultiTest',
      tenant_id: TENANT_ID,
    });

    const result = await model.findWhere([
      { id: { $in: [user1.id, user2.id] } },
    ]);

    expect(result.length).toBe(2);
    const emails = result.map(r => r.email);
    expect(emails).toContain('multiin1@example.com');
    expect(emails).toContain('multiin2@example.com');
  });
});
