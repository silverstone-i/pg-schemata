import { TableModel } from 'pg-schemata';

const usersSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  softDelete: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'email', type: 'varchar(255)', notNull: true },
    { name: 'first_name', type: 'varchar(100)' },
    { name: 'last_name', type: 'varchar(100)' },
    { name: 'is_active', type: 'boolean', default: 'true', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['email']],
  },
};

export class Users extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, usersSchema, logger);
  }
}