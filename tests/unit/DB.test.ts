/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// DB.test.js
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DB, db, pgp } from '../../src/DB.js'; // Adjust path
import type { ExtendedDb } from '../../src/DB.js';
import { callDb } from '../../src/utils/callDB.js'; // Adjust path
import { getAuditActor } from '../../src/auditActorResolver.js';
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
        const db = {
          mockDb: true,
          // Database.close() ends this instance's pool and nothing else.
          $pool: { end: vi.fn().mockResolvedValue(undefined) },
        };
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
  beforeEach(async () => {
    await DB.close();
    (pgPromise as unknown as Mock).mockClear();
  });

  afterEach(async () => {
    await DB.close();
  });

  it('leaves db and pgp undefined before initialization', () => {
    expect(DB.db).toBeUndefined();
    expect(DB.pgp).toBeUndefined();
    expect(db()).toBeUndefined();
    expect(pgp()).toBeUndefined();
  });

  it('supports the documented `if (!DB.db) DB.init(...)` guard', () => {
    if (!DB.db) DB.init({}, { users: FakeRepo });
    if (!DB.db) DB.init({}, { users: FakeRepo });
    expect(pgPromise).toHaveBeenCalledTimes(1);
    expect(db()).toBe(DB.db);
    expect(pgp()).toBe(DB.pgp);
  });

  it('keeps DB.db and DB.pgp writable for legacy callers', () => {
    DB.init({}, { users: FakeRepo });
    const replacement = { replaced: true } as unknown as ExtendedDb;
    // Reassignment is discouraged, but it remains part of the 3.x contract.
    DB.db = replacement;
    DB.pgp = undefined as unknown as IMain;
    expect(DB.db).toBe(replacement);
    expect(DB.pgp).toBeUndefined();
  });

  it('does not replace the audit resolver on a second init', () => {
    DB.init({}, { users: FakeRepo }, null, {
      auditActorResolver: () => 'first',
    });
    DB.init({}, { users: FakeRepo }, null, {
      auditActorResolver: () => 'second',
    });
    expect(getAuditActor()).toBe('first');
  });

  it('close() clears the singleton, its resolver, and allows a fresh init', async () => {
    DB.init({}, { users: FakeRepo }, null, {
      auditActorResolver: () => 'first',
    });
    const firstDb = DB.db;

    await DB.close();

    expect(DB.db).toBeUndefined();
    expect(DB.pgp).toBeUndefined();
    expect(getAuditActor()).toBeNull();

    DB.init({}, { users: FakeRepo });
    expect(DB.db).toBeDefined();
    expect(DB.db).not.toBe(firstDb);
  });

  it('close() is safe before initialization and when repeated', async () => {
    await expect(DB.close()).resolves.toBeUndefined();
    DB.init({}, { users: FakeRepo });
    await Promise.all([DB.close(), DB.close()]);
    expect(DB.db).toBeUndefined();
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
      // @ts-expect-error deliberately passes a string as the repositories map.
      // This used to compile: with Repositories un-augmented the old mapped
      // arm was `{}`, which accepts any non-nullish value. The runtime guard
      // is still what callers rely on, so the case stays covered.
      DB.init(connection, 'notAnObject');
    }).toThrow(Error);
  });

  it('should throw error if repositories is an array', () => {
    const connection = {};
    expect(() => {
      // @ts-expect-error deliberately passes an array as the repositories map
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
  beforeEach(async () => {
    await DB.close();
    (pgPromise as unknown as Mock).mockClear();
  });

  afterEach(async () => {
    await DB.close();
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
