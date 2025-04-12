'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import {
  addAuditFields,
  createIndexesSQL,
  createTableSQL,
  normalizeSQL,
} from '../src/utils/schemaBuilder';

const userSchema = {
  schemaName: 'nap',
  table: 'users',
  columns: [
    {
      name: 'id',
      type: 'uuid',
      default: 'uuid_generate_v4()',
      notNull: true,
      immutable: true,
    },
    { name: 'tenant_id', type: 'uuid', notNull: true, immutable: true },
    { name: 'email', type: 'character varying(30)', notNull: true },
    { name: 'password', type: 'character varying(30)', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
  },
};

const unique = {
  constraints: {
    unique: [
      ['tenant_id', 'email'], // Composite unique constraint
    ],
  },
};

const fk = {
  constraints: {
    foreignKeys: [
      {
        columns: ['tenant_id'],
        references: { schema: 'admin', table: 'tenants', columns: ['id'] },
        onDelete: 'CASCADE',
      },
    ],
  },
};

const checks = {
  constraints: { checks: [{ expression: 'length(email) > 3' }] },
};

const idx = {
  constraints: {
    indexes: [
      { name: 'idx_email', columns: ['email'] },
      { columns: ['tenant_id', 'email'] },
    ],
  },
};

let copiedSchema = {};
beforeEach(() => {
  copiedSchema = JSON.parse(JSON.stringify(userSchema));
});

describe('createTableSQL', () => {
  it('should generate SQL for a table with basic columns and primary key', () => {
    const actual = createTableSQL(copiedSchema).trim();
    const expected = `CREATE TABLE IF NOT EXISTS "nap"."users" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "email" character varying(30) NOT NULL,
      "password" character varying(30) NOT NULL,
      PRIMARY KEY ("id")
      );`;

    expect(normalizeSQL(actual)).toBe(normalizeSQL(expected));
  });

  it('should generate SQL for a table with unique constraints', () => {
    // Test case for unique constraints
    const schema = {
      ...copiedSchema,
      ...unique,
      constraints: {
        ...copiedSchema.constraints,
        ...(unique.constraints || {}),
      },
    };

    const actual = createTableSQL(schema);

    const expected = `CREATE TABLE IF NOT EXISTS "nap"."users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "email" character varying(30) NOT NULL,
      "password" character varying(30) NOT NULL,
      PRIMARY KEY ("id"),
      CONSTRAINT "uidx_users_tenant_id_email_d8980d" UNIQUE ("tenant_id", "email")
      );`;

    expect(normalizeSQL(actual)).toBe(normalizeSQL(expected));
  });

  it('should generate SQL for a table with foreign key constraints', () => {
    // Test case for foreign key constraints
    const schema = {
      ...copiedSchema,
      ...fk,
      constraints: {
        ...copiedSchema.constraints,
        ...(fk.constraints || {}),
      },
    };

    const actual = createTableSQL(schema);

    const expected = `CREATE TABLE IF NOT EXISTS "nap"."users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "email" character varying(30) NOT NULL,
      "password" character varying(30) NOT NULL,
      PRIMARY KEY ("id"),
      CONSTRAINT "fk_users_tenants_tenant_id_4d7c64" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants" ("id") ON DELETE CASCADE
      );`;

    expect(normalizeSQL(actual)).toBe(normalizeSQL(expected));
  });

  it('should generate SQL for a table with check constraints', () => {
    // Test case for check constraints
    const schema = {
      ...copiedSchema,
      ...checks,
      constraints: {
        ...copiedSchema.constraints,
        ...(checks.constraints || {}),
      },
    };

    const actual = createTableSQL(schema);

    const expected = `CREATE TABLE IF NOT EXISTS "nap"."users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "email" character varying(30) NOT NULL,
      "password" character varying(30) NOT NULL,
      PRIMARY KEY ("id"),
      CHECK (length(email) > 3)
      );`;

    expect(normalizeSQL(actual)).toBe(normalizeSQL(expected));
  });

  it('should generate SQL for adding indexes to a table.', () => {
    // Test case for adding indexes to a table
    const schema = {
      ...copiedSchema,
      ...idx,
      constraints: {
        ...copiedSchema.constraints,
        ...(idx.constraints || {}),
      },
    };

    const actual = createIndexesSQL(schema);
    const expected = `CREATE INDEX IF NOT EXISTS "idx_users_email" ON "nap"."users" (email);
    CREATE INDEX IF NOT EXISTS "idx_users_tenant_id_email" ON "nap"."users" (tenant_id, email);`;

    expect(normalizeSQL(actual)).toBe(normalizeSQL(expected));
  });

  it('should add audit fields to columns', () => {
    // Test case for adding audit fields to schema
    const schema = addAuditFields(copiedSchema);

    expect(schema.columns.length).toBe(8);
    expect(schema.columns[4].name).toBe('created_at');
    expect(schema.columns[5].name).toBe('created_by');
    expect(schema.columns[6].name).toBe('updated_at');
    expect(schema.columns[7].name).toBe('updated_by');
    expect(schema.columns[4].type).toBe('timestamp');
    expect(schema.columns[5].type).toBe('varchar(50)');
    expect(schema.columns[6].type).toBe('timestamp');
    expect(schema.columns[7].type).toBe('varchar(50)');
    expect(schema.columns[4].default).toBe('now()');
    expect(schema.columns[5].default).toBe('system');
    expect(schema.columns[6].default).toBe('now()');
    expect(schema.columns[7].default).toBe('system');
    expect(schema.columns[4].immutable).toBe(true);
    expect(schema.columns[4].immutable).toBe(true);
    expect(schema.columns[5].immutable).toBe(true);
    expect(schema.columns[6].immutable).toBeUndefined();
  });

  it('should generate the proper SQL for all of the CREATE TABLE options defined in this file', () => {
    // Test case for complet CREATE TABLE statement
    const schema = {
      ...copiedSchema,
      ...unique,
      ...fk,
      ...checks,
      constraints: {
        ...copiedSchema.constraints,
        ...(unique.constraints || {}),
        ...(fk.constraints || {}),
        ...(checks.constraints || {}),
      },
    };

    addAuditFields(schema);
    const actual = createTableSQL(schema);

    const expected = `CREATE TABLE IF NOT EXISTS "nap"."users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "email" character varying(30) NOT NULL,
      "password" character varying(30) NOT NULL,
      "created_at" timestamp DEFAULT now(),
      "created_by" varchar(50) DEFAULT system,
      "updated_at" timestamp DEFAULT now(),
      "updated_by" varchar(50) DEFAULT system,
      PRIMARY KEY ("id"),
      CONSTRAINT "uidx_users_tenant_id_email_d8980d" UNIQUE ("tenant_id", "email"),
      CONSTRAINT "fk_users_tenants_tenant_id_4d7c64" FOREIGN KEY ("tenant_id") REFERENCES "admin"."tenants" ("id") ON DELETE CASCADE,
      CHECK (length(email) > 3)
      );`;

    expect(normalizeSQL(actual)).toBe(normalizeSQL(expected));
  });

  it('should generate the proper SQL for for complex foreign key', () => {
    // Test case for complex foreign key
    const complexFK = {
      constraints: {
        foreignKeys: [
          {
            columns: ['tenant_id', 'email'],
            references: {
              schema: 'admin',
              table: 'tenants',
              columns: ['tenant_id', 'email'],
            },
            onDelete: 'CASCADE',
          },
        ],
      },
    };
    const schema = {
      ...copiedSchema,
      ...complexFK,
      constraints: {
        ...copiedSchema.constraints,
        ...(complexFK.constraints || {}),
      },
    };

    addAuditFields(schema);
    const actual = createTableSQL(schema);

    const expected = `CREATE TABLE IF NOT EXISTS "nap"."users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenant_id" uuid NOT NULL,
      "email" character varying(30) NOT NULL,
      "password" character varying(30) NOT NULL,
      "created_at" timestamp DEFAULT now(),
      "created_by" varchar(50) DEFAULT system,
      "updated_at" timestamp DEFAULT now(),
      "updated_by" varchar(50) DEFAULT system,
      PRIMARY KEY ("id"),
      CONSTRAINT "fk_users_tenants_tenant_id_email_f79ee9" FOREIGN KEY ("tenant_id", "email") REFERENCES "admin"."tenants" ("tenant_id", "email") ON DELETE CASCADE
      );`;

    expect(normalizeSQL(actual)).toBe(normalizeSQL(expected));
  });
});
