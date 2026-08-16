export const customersSchema = {
  dbSchema: 'public',
  table: 'customers',
  hasAuditFields: true,
  // Required by the partial index below: `deactivated_at IS NULL` is raw SQL
  // emitted into the CREATE INDEX as written, and the column only exists when
  // soft delete is enabled. Without this the whole table fails to create.
  softDelete: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'email', type: 'varchar(255)', notNull: true },
    { name: 'full_name', type: 'varchar(200)', notNull: true },
    { name: 'phone', type: 'varchar(50)' },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['email']],
    indexes: [
      // Simple index on phone for quick lookups
      { columns: ['phone'] },
      // Partial index for searching active customers by name
      {
        columns: ['full_name'],
        where: 'deactivated_at IS NULL',
      },
      // Composite index for customer search with custom name
      {
        name: 'idx_customers_search',
        columns: ['email', 'full_name'],
        using: 'btree',
      },
    ],
  },
};
