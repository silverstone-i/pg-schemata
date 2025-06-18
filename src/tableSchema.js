'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

const tableSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  version: '1.0.0',
  columns: [
    {
      name: 'id',
      type: 'uuid',
      default: 'gen_random_uuid()',
      nullable: false,
      immutable: true,
      colProps: { cnd: true },
    },
    {
      name: 'tenant_id',
      type: 'uuid',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'password_hash',
      type: 'text',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'first_name',
      type: 'varchar(100)',
      nullable: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'last_name',
      type: 'varchar(100)',
      nullable: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'address',
      type: 'jsonb',
      nullable: true,
      colProps: { mod: ':json', skip: c => !c.exists },
    },
    {
      name: 'is_active',
      type: 'boolean',
      default: 'true',
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'role',
      type: 'varchar(50)',
      default: `'user'`,
      nullable: false,
      colProps: { skip: c => !c.exists },
    },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['tenant_id', 'email']],
    foreignKeys: [
      {
        type: 'ForeignKey',
        columns: ['tenant_id'],
        references: {
          table: 'admin.tenants(id)',
          column: ['id'],
        },
        onDelete: 'CASCADE',
      },
    ],
    checks: [
      {
        type: 'Check',
        expression: `char_length(email) > 3`,
      },
      {
        type: 'Check',
        expression: `role IN ('user', 'admin', 'moderator')`,
      },
    ],
    indexes: [
      {
        type: 'Index',
        columns: ['email'],
      },
      {
        type: 'Index',
        columns: ['tenant_id', 'role'],
      },
    ],
  },
};
