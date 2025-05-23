// DB.test.js
import { DB, callDb } from '../../src/DB'; // Adjust path
import pgPromise from 'pg-promise';

jest.mock('pg-promise', () => {
  return jest.fn(initOptions => {
    return connection => {
      const db = { mockDb: true };
      if (initOptions && typeof initOptions.extend === 'function') {
        initOptions.extend(db, null); // 💥 simulate pg-promise calling extend()
      }
      return db;
    };
  });
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

  test('should initialize db and pgp properly', () => {
    const connection = {}; // mock connection
    const repositories = { users: FakeRepo }; // mock repository

    const dbClass = DB.init(connection, repositories); // returns the DB class

    expect(pgPromise).toHaveBeenCalledTimes(1); // pgPromise initialized once

    expect(DB.db).toBeDefined(); // db is created
    expect(DB.pgp).toBeDefined(); // pgp is created

    // Check that the db has the repository attached
    expect(typeof DB.db.users).toBe('object');
    expect(DB.db.users).toBeInstanceOf(FakeRepo);

    expect(dbClass).toBe(DB); // init returns DB class
  });

  test('should return the same instance if init is called multiple times', () => {
    const connection = {}; // Mock connection
    const repositories = { users: FakeRepo }; // Mock repositories

    const firstCall = DB.init(connection, repositories);
    const secondCall = DB.init(connection, repositories);

    expect(firstCall).toBe(DB); // firstCall returns the DB class
    expect(secondCall).toBe(DB); // secondCall returns the same DB class

    expect(DB.db).toBeDefined(); // db should be set
    expect(DB.pgp).toBeDefined(); // pgp should be set

    expect(pgPromise).toHaveBeenCalledTimes(1); // pgPromise should only be initialized once
  });

  test('should throw error if connection is undefined', () => {
    const repositories = { users: FakeRepo };
    expect(() => {
      DB.init(undefined, repositories);
    }).toThrow(Error);
  });

  test('should throw error if repositories are undefined', () => {
    const connection = {}; // mock connection
    expect(() => {
      DB.init(connection, undefined);
    }).toThrow(Error);
  });

  test('should throw error if repositories is not an object', () => {
    const connection = {}; // mock connection
    expect(() => {
      DB.init(connection, 'notAnObject');
    }).toThrow(Error);
  });

  test('should throw error if repositories is an array', () => {
    const connection = {}; // mock connection
    expect(() => {
      DB.init(connection, []);
    }).toThrow(Error);
  });

  test('should throw error if repositories is null', () => {
    const connection = {}; // mock connection
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

  test('callDb(<model>, <schema>) should return model instance with correct schema', () => {
    const connection = {};
    const repositories = { foo: FakeSchemaRepo };

    DB.init(connection, repositories);

    const instance = callDb(DB.db.foo, 'test_schema');
    expect(instance).toBeInstanceOf(FakeSchemaRepo);
    expect(instance.schema).toBe('test_schema');
  });
});