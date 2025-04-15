// ===============================
// tests/fixtures/testUserSchema.js
// ===============================

export const testUserSchema = {
  dbSchema: 'test_schema',
  table: 'test_users',
  columns: [
    { name: 'id', type: 'uuid', default: 'uuid_generate_v4()', notNull: true },
    { name: 'email', type: 'text', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
  },
};

