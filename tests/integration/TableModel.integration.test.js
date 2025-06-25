// ===============================
// tests/integration/TableModel.integration.test.js
// ===============================

import { createTestContext } from '../helpers/integrationHarness.js';
import { testUserSchema } from '../helpers/testUserSchema.js';
import path from 'path';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';

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
      tenant_id: TENANT_ID,
    });
    const found = await model.findById(inserted.id);
    expect(found.email).toBe('test@example.com');
  });

  test('manual update for user email', async () => {
    const user = await model.insert({
      email: 'manual@test.com',
      created_by: 'Manual Tester',
      tenant_id: TENANT_ID,
    });

    const newEmail = 'manually-updated@example.com';
    const updatedBy = 'Admin User';

    await ctx.db.none(
      `UPDATE "${model.schema.dbSchema}"."${model.schema.table}" SET email = $1, updated_by = $2 WHERE id = $3`,
      [newEmail, updatedBy, user.id]
    );

    const found = await model.findById(user.id);
    expect(found.email).toBe(newEmail);
    expect(found.updated_by).toBe(updatedBy);
  });

  test('delete user', async () => {
    const user = await model.insert({
      email: 'delete@example.com',
      created_by: 'Jane Doe',
      tenant_id: TENANT_ID,
    });
    await model.delete(user.id);
    const shouldBeNull = await model.findById(user.id);
    expect(shouldBeNull).toBeNull();
  });

  test('updateWhere should update multiple users', async () => {
    await model.insert({
      email: 'a@test.com',
      created_by: 'updateWhere',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'b@test.com',
      created_by: 'updateWhere',
      tenant_id: TENANT_ID,
    });

    const count = await model.updateWhere([{ created_by: 'updateWhere' }], {
      updated_by: 'bulk-editor',
    });

    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('updateWhere should apply $ilike operator', async () => {
    await model.insert({
      email: 'ilike1@example.com',
      created_by: 'test',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'ilike2@example.com',
      created_by: 'test',
      tenant_id: TENANT_ID,
    });

    let count;
    try {
      count = await model.updateWhere([{ email: { $ilike: '%ilike%' } }], {
        updated_by: 'ilike-editor',
      });
    } catch (error) {
      console.error('Error during updateWhere:', error);
    }

    expect(count).toBeGreaterThanOrEqual(2);
    let updated;
    try {
      updated = await model.findWhere([{ updated_by: 'ilike-editor' }]);
    } catch (error) {
      console.error('Error during findWhere:', error);
    }
    expect(updated.length).toBeGreaterThanOrEqual(2);
  });

  test('updateWhere should apply nested $or condition', async () => {
    await model.insert({
      email: 'or1@example.com',
      created_by: 'X',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'or2@example.com',
      created_by: 'Y',
      tenant_id: TENANT_ID,
    });

    const count = await model.updateWhere(
      { $or: [{ created_by: 'X' }, { created_by: 'Y' }] },
      { updated_by: 'or-editor' }
    );

    expect(count).toBeGreaterThanOrEqual(2);
    const updated = await model.findWhere([{ updated_by: 'or-editor' }]);
    expect(updated.length).toBeGreaterThanOrEqual(2);
  });

  test('updateWhere should apply OR join type with array of conditions', async () => {
    await model.insert({
      email: 'join1@example.com',
      created_by: 'Z',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'join2@example.com',
      created_by: 'W',
      tenant_id: TENANT_ID,
    });

    const count = await model.updateWhere(
      { $or: [{ created_by: 'Z' }, { created_by: 'W' }] },
      { updated_by: 'or-join-editor' }
    );

    expect(count).toBeGreaterThanOrEqual(2);

    const updated = await model.findWhere([{ updated_by: 'or-join-editor' }]);
    expect(updated.length).toBeGreaterThanOrEqual(2);
  });

  test('updateWhere should throw if where clause is empty', async () => {
    await expect(
      model.updateWhere({}, { updated_by: 'nobody' })
    ).rejects.toThrow('WHERE clause must be a non-empty object');
  });

  test('updateWhere should throw if update payload is empty', async () => {
    await expect(
      model.updateWhere({ created_by: 'anyone' }, {})
    ).rejects.toThrow('UPDATE payload must be a non-empty object');
  });

  test('updateWhere should apply deeply nested OR/AND combinations', async () => {
    await model.insert({
      email: 'nested1@example.com',
      created_by: 'admin',
      is_active: true,
      tenant_id: 'ba0c7aeb-6b68-4ddf-b39f-f9c8c41ec989',
    });
    await model.insert({
      email: 'vipuser@example.com',
      created_by: 'admin',
      is_active: false,
      tenant_id: 'ba0c7aeb-6b68-4ddf-b39f-f9c8c41ec990',
    });
    await model.insert({
      email: 'stale@example.com',
      created_by: 'admin',
      is_active: false,
      created_at: '2024-01-01',
      updated_by: 'system',
      tenant_id: 'ba0c7aeb-6b68-4ddf-b39f-f9c8c41ec989',
    });

    const whereClause = [
      {
        $or: [
          {
            $and: [{ created_by: 'admin' }, { email: { $ilike: '%vip%' } }],
          },
          {
            $or: [
              {
                $and: [
                  { is_active: false },
                  { created_at: { $to: '2024-12-31' } },
                ],
              },
              { updated_by: 'system' },
            ],
          },
        ],
      },
      {
        $or: [
          { tenant_id: 'ba0c7aeb-6b68-4ddf-b39f-f9c8c41ec989' },
          { tenant_id: 'ba0c7aeb-6b68-4ddf-b39f-f9c8c41ec990' },
        ],
      },
    ];

    const updates = { updated_by: 'deep-nested-editor' };

    const count = await model.updateWhere(whereClause, updates);
    expect(count).toBeGreaterThanOrEqual(2);

    const updated = await model.findWhere([
      { updated_by: 'deep-nested-editor' },
    ]);
    expect(updated.length).toBeGreaterThanOrEqual(2);
  });

  test('deleteWhere should remove multiple users', async () => {
    await model.insert({
      email: 'c@test.com',
      created_by: 'deleteWhere',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'd@test.com',
      created_by: 'deleteWhere',
      tenant_id: TENANT_ID,
    });

    const count = await model.deleteWhere({ created_by: 'deleteWhere' });
    expect(count).toBe(2);
  });

  test('deleteWhere should apply (field1 OR field2) AND field3 condition', async () => {
    await model.insert({
      email: 'x@test.com',
      created_by: 'multi-delete',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'y@test.com',
      created_by: 'multi-delete',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'z@test.com',
      created_by: 'should-stay',
      tenant_id: TENANT_ID,
    });

    const whereClause = [
      {
        $or: [{ email: 'x@test.com' }, { email: 'y@test.com' }],
      },
      { created_by: 'multi-delete' },
    ];

    const count = await model.deleteWhere(whereClause);
    expect(count).toBe(2);

    const remaining = await model.findWhere([{ created_by: 'should-stay' }]);
    expect(remaining.length).toBe(1);
  });

  test('bulkInsert should insert multiple users correctly', async () => {
    const newUsers = [
      {
        email: 'bulk1@test.com',
        created_by: 'bulk-insert',
        tenant_id: TENANT_ID,
      },
      {
        email: 'bulk2@test.com',
        created_by: 'bulk-insert',
        tenant_id: TENANT_ID,
      },
      {
        email: 'bulk3@test.com',
        created_by: 'bulk-insert',
        tenant_id: TENANT_ID,
      },
    ];

    const insertedCount = await model.bulkInsert(newUsers);

    expect(insertedCount).toBe(3);

    const inserted = await model.findWhere([{ created_by: 'bulk-insert' }]);
    expect(inserted.length).toBe(3);
    const emails = inserted.map(u => u.email).sort();
    expect(emails).toEqual([
      'bulk1@test.com',
      'bulk2@test.com',
      'bulk3@test.com',
    ]);
  });

  test('bulkUpdate should modify multiple users in one call', async () => {
    const users = await Promise.all([
      model.insert({
        email: 'bu1@test.com',
        created_by: 'bulk-update',
        tenant_id: TENANT_ID,
      }),
      model.insert({
        email: 'bu2@test.com',
        created_by: 'bulk-update',
        tenant_id: TENANT_ID,
      }),
    ]);

    const updates = users.map(u => ({
      id: u.id,
      updated_by: 'updated-bulk',
      updated_at: new Date().toISOString(),
      tenant_id: TENANT_ID,
    }));

    await model.bulkUpdate(updates);

    const results = await model.findWhere([{ created_by: 'bulk-update' }]);
    expect(results.every(r => r.updated_by === 'updated-bulk')).toBe(true);
  });

  test('bulkUpdate should apply updates based on id with mixed fields', async () => {
    const users = await Promise.all([
      model.insert({
        email: 'bulkA@test.com',
        created_by: 'mixed-bulk-update',
        tenant_id: TENANT_ID,
      }),
      model.insert({
        email: 'bulkB@test.com',
        created_by: 'mixed-bulk-update',
        tenant_id: TENANT_ID,
      }),
    ]);

    const updates = users.map((u, i) => ({
      id: u.id,
      updated_by: 'updated-mixed',
      notes: `Note ${i + 1}`,
      tenant_id: TENANT_ID,
    }));

    await model.bulkUpdate(updates);

    const updated = await model.findWhere([
      { created_by: 'mixed-bulk-update' },
    ]);
    expect(updated.length).toBe(2);
    expect(updated.every(u => u.updated_by === 'updated-mixed')).toBe(true);
    expect(updated.map(u => u.notes).sort()).toEqual(['Note 1', 'Note 2']);
  });

  test('bulkInsert should fail validation for invalid records', async () => {
    const badRecords = [
      { created_by: 'bad-user', tenant_id: TENANT_ID }, // missing email
      { email: 12345, created_by: 'bad-user', tenant_id: TENANT_ID }, // invalid email
    ];

    await expect(model.bulkInsert(badRecords)).rejects.toThrow(/Insert DTO validation failed/);
  });

  test('bulkUpdate should fail validation for invalid records', async () => {
    const user = await model.insert({
      email: 'valid@example.com',
      created_by: 'for-bad-update',
      tenant_id: TENANT_ID,
    });

    const badUpdates = [
      {
        id: user.id,
        updated_by: 999, // invalid type
        tenant_id: TENANT_ID,
      },
      {
        id: user.id,
        updated_at: 'not-a-date', // invalid format
        tenant_id: TENANT_ID,
      },
    ];

    await expect(model.bulkUpdate(badUpdates)).rejects.toThrow(/Update DTO validation failed/);
  });

  test('importFromSpreadsheet should import records from an xlsx file', async () => {
    // console.log('Importing from spreadsheet...', __dirname);

    const filePath = path.join(
      __dirname,
      `../helpers/test_users_two_sheets.xlsx`
    );

    let result;
    try {
      result = await model.importFromSpreadsheet(filePath, 0);
    } catch (error) {
      console.error('Error during import:', error);
    }

    expect(result.inserted).toBeGreaterThanOrEqual(1);

    const imported = await model.findWhere([{ created_by: 'xlsx-importer' }]);
    expect(imported.length).toBe(result.inserted);
  });

  test('importFromSpreadsheet should import records from sheet index 1', async () => {
    // console.log('Importing from spreadsheet (sheet 1)...', __dirname);

    const filePath = path.join(
      __dirname,
      `../helpers/test_users_two_sheets.xlsx`
    );

    let result;
    try {
      result = await model.importFromSpreadsheet(filePath, 1);
    } catch (error) {
      console.error('Error during import:', error);
    }

    expect(result.inserted).toBeGreaterThanOrEqual(1);

    const imported = await model.findWhere([{ created_by: 'xlsx-importer' }]);
    expect(imported.length).toBeGreaterThanOrEqual(result.inserted);
  });
  test('truncate should remove all records from the table', async () => {
    // Insert some records
    await model.insert({
      email: 'truncate1@test.com',
      created_by: 'truncate-test',
      tenant_id: TENANT_ID,
    });
    await model.insert({
      email: 'truncate2@test.com',
      created_by: 'truncate-test',
      tenant_id: TENANT_ID,
    });

    // Verify records exist
    const existing = await model.findWhere([{ created_by: 'truncate-test' }]);
    expect(existing.length).toBe(2);

    // Truncate the table
    await model.truncate();

    // Verify table is empty
    const all = await model.findAll();
    expect(all).toEqual([]);
  });
});