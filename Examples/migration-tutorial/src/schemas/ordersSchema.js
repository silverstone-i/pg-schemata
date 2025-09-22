export const ordersSchema = {
  dbSchema: 'public',
  table: 'orders',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'customer_id', type: 'uuid', notNull: true },
    { name: 'order_number', type: 'varchar(20)', notNull: true },
    { name: 'order_total', type: 'numeric(12,2)', notNull: true, default: '0' },
    { name: 'placed_at', type: 'timestamptz', notNull: true, default: 'now()' },
    { name: 'status', type: 'varchar(20)', notNull: true, default: "'pending'" },
    { name: 'shipped_at', type: 'timestamptz' },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['order_number']],
    foreignKeys: [
      {
        columns: ['customer_id'],
        references: { dbSchema: 'public', table: 'customers', columns: ['id'] },
        onDelete: 'CASCADE',
      },
    ],
  },
};
