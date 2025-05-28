// DB.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DB, callDb } from '../../src/DB'; // Adjust path
import pgPromise from 'pg-promise';

vi.mock('pg-promise', () => {
  return {
    default: vi.fn(initOptions => {
      return connection => {
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
  constructor(db, pgp) {
    this.db = db;
    this.pgp = pgp;
  }
}

describe('DB', () => {
  beforeEach(() => {
    DB.db = undefined;
    DB.pgp = undefined;
    pgPromise.mockClear();
  });

  it('should initialize db and pgp properly', () => {
    const connection = {};
    const repositories = { users: FakeRepo };

    const dbClass = DB.init(connection, repositories);

    expect(pgPromise).toHaveBeenCalledTimes(1);
    expect(DB.db).toBeDefined();
    expect(DB.pgp).toBeDefined();
    expect(typeof DB.db.users).toBe('object');
    expect(DB.db.users).toBeInstanceOf(FakeRepo);
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
      DB.init(undefined, repositories);
    }).toThrow(Error);
  });

  it('should throw error if repositories are undefined', () => {
    const connection = {};
    expect(() => {
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
      DB.init(connection, null);
    }).toThrow(Error);
  });
});

class FakeSchemaRepo {
  constructor(db, pgp) {
    this.db = db;
    this.pgp = pgp;
  }
  setSchemaName(name) {
    this.schema = name;
    return this;
  }
}

describe('callDb logic', () => {
  beforeEach(() => {
    DB.db = undefined;
    DB.pgp = undefined;
    pgPromise.mockClear();
  });

  it('callDb(<model>, <schema>) should return model instance with correct schema', () => {
    const connection = {};
    const repositories = { foo: FakeSchemaRepo };

    DB.init(connection, repositories);

    const instance = callDb(DB.db.foo, 'test_schema');
    expect(instance).toBeInstanceOf(FakeSchemaRepo);
    expect(instance.schema).toBe('test_schema');
  });
});