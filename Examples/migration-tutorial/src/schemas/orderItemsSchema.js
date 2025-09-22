export const orderItemsSchema = {
  dbSchema: 'public',
  table: 'order_items',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'order_id', type: 'uuid', notNull: true },
    { name: 'sku', type: 'varchar(64)', notNull: true },
    { name: 'quantity', type: 'integer', notNull: true, default: '1' },
    { name: 'unit_price', type: 'numeric(12,2)', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['order_id', 'sku']],
    foreignKeys: [
      {
        columns: ['order_id'],
        references: { dbSchema: 'public', table: 'orders', columns: ['id'] },
        onDelete: 'CASCADE',
      },
    ],
  },
};
