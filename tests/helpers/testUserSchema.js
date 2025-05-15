// ===============================
// tests/fixtures/testUserSchema.js
// ===============================

export const testUserSchema = {
  dbSchema: 'test_schema',
  table: 'test_users',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'uuid_generate_v4()', notNull: true },
    { name: 'tenant_id', type: 'uuid', notNull: true },
    { name: 'email', type: 'text', notNull: true },
    { name: 'notes', type: 'text', default: null },
    { name: 'is_active', type: 'boolean', default: true },
  ],
  constraints: {
    primaryKey: ['id'],
  },
};
