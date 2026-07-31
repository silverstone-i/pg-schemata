/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// DB.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DB } from '../../src/DB.js'; // Adjust path
import type { ExtendedDb } from '../../src/DB.js';
import { callDb } from '../../src/utils/callDB.js'; // Adjust path
import pgPromise from 'pg-promise';
import type { IMain } from 'pg-promise';
import type { DbConnection } from '../../src/schemaTypes.js';

interface MockInitOptions {
  extend?: (obj: unknown, dc: unknown) => void;
}

vi.mock('pg-promise', () => {
  return {
    default: vi.fn((initOptions: MockInitOptions | undefined) => {
      return (connection: unknown) => {
        const db = { mockDb: true };
        if (initOptions && typeof initOptions.extend === 'function') {
          initOptions.extend(db, null);
        }
        return db;
      };
    }),
  };
});

class FakeRepo {
  db: DbConnection;
  pgp: IMain;
  constructor(db: DbConnection, pgp: IMain) {
    this.db = db;
    this.pgp = pgp;
  }
}

describe('DB', () => {
  beforeEach(() => {
    DB.db = undefined as unknown as ExtendedDb;
    DB.pgp = undefined as unknown as IMain;
    (pgPromise as unknown as Mock).mockClear();
  });

  it('should initialize db and pgp properly', () => {
    const connection = {};
    const repositories = { users: FakeRepo };

    const dbClass = DB.init(connection, repositories);

    expect(pgPromise).toHaveBeenCalledTimes(1);
    expect(DB.db).toBeDefined();
    expect(DB.pgp).toBeDefined();
    const extendedDb = DB.db as ExtendedDb & { users: FakeRepo };
    expect(typeof extendedDb.users).toBe('object');
    expect(extendedDb.users).toBeInstanceOf(FakeRepo);
    expect(dbClass).toBe(DB);
  });

  it('should return the same instance if init is called multiple times', () => {
    const connection = {};
    const repositories = { users: FakeRepo };

    const firstCall = DB.init(connection, repositories);
    const secondCall = DB.init(connection, repositories);

    expect(firstCall).toBe(DB);
    expect(secondCall).toBe(DB);
    expect(DB.db).toBeDefined();
    expect(DB.pgp).toBeDefined();
    expect(pgPromise).toHaveBeenCalledTimes(1);
  });

  it('should throw error if connection is undefined', () => {
    const repositories = { users: FakeRepo };
    expect(() => {
      // @ts-expect-error deliberately passes undefined as the connection
      DB.init(undefined, repositories);
    }).toThrow(Error);
  });

  it('should throw error if repositories are undefined', () => {
    const connection = {};
    expect(() => {
      // @ts-expect-error deliberately passes undefined as the repositories map
      DB.init(connection, undefined);
    }).toThrow(Error);
  });

  it('should throw error if repositories is not an object', () => {
    const connection = {};
    expect(() => {
      DB.init(connection, 'notAnObject');
    }).toThrow(Error);
  });

  it('should throw error if repositories is an array', () => {
    const connection = {};
    expect(() => {
      DB.init(connection, []);
    }).toThrow(Error);
  });

  it('should throw error if repositories is null', () => {
    const connection = {};
    expect(() => {
      // @ts-expect-error deliberately passes null as the repositories map
      DB.init(connection, null);
    }).toThrow(Error);
  });
});

class FakeSchemaRepo {
  db: DbConnection;
  pgp: IMain;
  schema?: string;
  constructor(db: DbConnection, pgp: IMain) {
    this.db = db;
    this.pgp = pgp;
  }
  forSchema(name: string): this {
    this.schema = name;
    return this;
  }
}

describe('callDb logic', () => {
  beforeEach(() => {
    DB.db = undefined as unknown as ExtendedDb;
    DB.pgp = undefined as unknown as IMain;
    (pgPromise as unknown as Mock).mockClear();
  });

  it('callDb(<model>, <schema>) should return model instance with correct schema', () => {
    const connection = {};
    const repositories = { foo: FakeSchemaRepo };

    DB.init(connection, repositories);

    const instance = callDb(
      (DB.db as ExtendedDb & { foo: FakeSchemaRepo }).foo,
      'test_schema'
    );
    expect(instance).toBeInstanceOf(FakeSchemaRepo);
    expect(instance.schema).toBe('test_schema');
  });
});
