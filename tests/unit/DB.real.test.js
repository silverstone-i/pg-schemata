import { DB, callDb } from '../../src/DB.js';
import pgp from 'pg-promise';
import { expect } from '@jest/globals';
import TableModel from '../../src/TableModel.js';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST || 'postgres://localhost:5432/nap_test';

describe('DB.real.test.js – Real DB wiring', () => {
  const usersSchema = {
    dbSchema: 'public',
    table: 'users',
    version: '0.1.0',
    hasAuditFields: false,

    columns: [
      {
        name: 'email',
        type: 'varchar',
        length: 255,
        nullable: false,
        colProps: { skip: c => !c.exists },
      },
      {
        name: 'name',
        type: 'varchar',
        length: 100,
        nullable: true,
        // default: null,
        colProps: { skip: c => !c.exists },
      },
    ],

    constraints: {
      primaryKey: ['email'],
      unique: [['name']],
    },
  };

  class Users extends TableModel {
    constructor(db, pgp) {
      super(db, pgp, usersSchema);
    }
  }

  const repositories = {
    users: Users,
  };

  beforeAll(() => {
    // Ensure real database is initialized with repositories
    DB.init(TEST_DB_URL, repositories);
  });

  it('should contain a fully initialize DB instance with an instantiated users model object', () => {
    expect(DB.db).toBeDefined();
    expect(DB.db.users).toBeDefined();
    expect(DB.db.users).toBeInstanceOf(Users);
    expect(DB.db.users.schema).toBeDefined();
    expect(DB.db.users.schema).toEqual(usersSchema);
    expect(DB.db.users.schemaName).toBe('"public"');
  });

  test('callDb.users should be attached and schema-aware', () => {
    expect(callDb).toBeDefined();
    expect(callDb.users).toBeDefined();
    expect(callDb.users).toBeInstanceOf(Users);
    expect(callDb.users.schema).toBeDefined();
    expect(callDb.users.schema).toEqual(usersSchema);
    expect(callDb.users.schemaName).toBe('"public"');

    expect(typeof callDb.users.setSchemaName).toBe('function');

    const instance = callDb('users', 'public');
    expect(instance).toBeInstanceOf(Users);
    expect(instance.schema).toEqual(usersSchema);
    expect(instance.schemaName).toBe('"public"');
  });
});
