export const customersSchema = {
  dbSchema: 'public',
  table: 'customers',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'email', type: 'varchar(255)', notNull: true },
    { name: 'full_name', type: 'varchar(200)', notNull: true },
    { name: 'phone', type: 'varchar(50)' },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['email']],
  },
};
