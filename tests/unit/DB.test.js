// DB.test.js
import DB from '../../src/DB'; // Adjust path
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
    const repositories = { users: FakeRepo };

    const dbInstance = DB.init(connection, repositories);

    expect(pgPromise).toHaveBeenCalledTimes(1);
    expect(dbInstance).toMatchObject({ mockDb: true });
    expect(DB.db).toBe(dbInstance);
    expect(DB.pgp).toBeDefined();
    expect(typeof dbInstance.users).toBe('object');
    expect(dbInstance.users).toBeInstanceOf(FakeRepo);
  });

  test('should return the same instance if init is called multiple times', () => {
    const connection = {}; // mock connection object
    const repositories = { users: FakeRepo };

    const firstInstance = DB.init(connection, repositories);
    const secondInstance = DB.init(connection, repositories);

    expect(firstInstance).toBe(secondInstance); // Singleton behavior
    expect(pgPromise).toHaveBeenCalledTimes(1); // pgPromise called only once
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
