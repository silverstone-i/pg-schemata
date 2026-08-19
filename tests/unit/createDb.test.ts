/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// Unit coverage for the database factory. A pg-promise database object does
// not open a connection when it is created (pools are lazy), so instance
// isolation, configuration, and lifecycle are all exercised here without a
// server. The real pg-promise is used — not the module mock in DB.test.ts.

import { describe, it, expect, afterEach, expectTypeOf, vi } from 'vitest';
import { createDb, Database } from '../../src/Database.js';
import { DB } from '../../src/DB.js';
import { callDb } from '../../src/utils/callDB.js';
import DatabaseError from '../../src/DatabaseError.js';
import { AUDIT_RESOLVER } from '../../src/auditScope.js';
import TableModel from '../../src/TableModel.js';
import {
  clearAuditActorResolver,
  setAuditActorResolver,
} from '../../src/auditActorResolver.js';
import type {
  DbConnection,
  Logger,
  TableSchema,
} from '../../src/schemaTypes.js';
import type { IMain } from 'pg-promise';

const ADMIN_URL = 'postgres://admin:secret@admin.example:5432/admin_db';
const CELL_URL = 'postgres://cell:secret@cell.example:5432/cell_db';

/** Instances created by a test, closed after it. */
const open: Database<any>[] = [];

function track<T extends Database<any>>(instance: T): T {
  open.push(instance);
  return instance;
}

afterEach(async () => {
  // Every real pg-promise pool created here is released.
  await Promise.all(open.splice(0).map(instance => instance.close()));
  await DB.close();
  clearAuditActorResolver();
});

const userSchema: TableSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'email', type: 'text', notNull: true },
  ],
  constraints: { primaryKey: ['id'] },
};

class Users extends TableModel {
  constructor(db: DbConnection, pgp: IMain, logger: Logger | null = null) {
    super(db, pgp, userSchema, logger);
  }
  whoAmI(): string {
    return 'users';
  }
}

class Orders extends TableModel {
  constructor(db: DbConnection, pgp: IMain, logger: Logger | null = null) {
    super(db, pgp, { ...userSchema, table: 'orders' }, logger);
  }
  whoAmI(): string {
    return 'orders';
  }
}

describe('createDb — repository typing', () => {
  it('infers repositories by name and instance type', () => {
    const admin = track(
      createDb({ connectionString: ADMIN_URL, repositories: { users: Users } })
    );
    expectTypeOf(admin.db.users).toEqualTypeOf<Users>();
    expect(admin.db.users).toBeInstanceOf(Users);
  });

  it('gives two instances unrelated repository types', () => {
    const admin = track(
      createDb({ connectionString: ADMIN_URL, repositories: { users: Users } })
    );
    const cell = track(
      createDb({ connectionString: CELL_URL, repositories: { orders: Orders } })
    );
    expectTypeOf(cell.db.orders).toEqualTypeOf<Orders>();
    // @ts-expect-error `orders` belongs to the cell instance, not the admin one
    expect(admin.db.orders).toBeUndefined();
    // @ts-expect-error `users` belongs to the admin instance, not the cell one
    expect(cell.db.users).toBeUndefined();
  });

  it('does not invent a string-indexed registry when repositories are omitted', () => {
    const plain = track(createDb({ connectionString: ADMIN_URL }));
    // @ts-expect-error no repositories were configured, so none are typed
    expect(plain.db.anything).toBeUndefined();
  });
});

describe('createDb — repository registry', () => {
  it('rejects an invalid constructor before any pool is created', () => {
    expect(() =>
      createDb({
        connectionString: ADMIN_URL,
        repositories: { users: 'nope' as unknown as typeof Users },
      })
    ).toThrow(/Repository "users" is not a valid constructor/);
  });

  it('rejects repository names that would overwrite forSchema metadata', () => {
    for (const name of ['db', 'pgp', 'schema']) {
      expect(() =>
        createDb({
          connectionString: ADMIN_URL,
          repositories: { [name]: Users },
        })
      ).toThrow(/is reserved/);
    }
  });

  it('rejects a non-object repositories map', () => {
    expect(() =>
      createDb({
        connectionString: ADMIN_URL,
        repositories: [] as unknown as Record<string, typeof Users>,
      })
    ).toThrow(/repositories map/);
  });

  it('ignores mutation of the caller map for root, task and transaction repositories', () => {
    const repositories: Record<string, typeof Users> = { users: Users };
    const instance = track(
      createDb({ connectionString: ADMIN_URL, repositories })
    );

    // Mutating the caller's object must not reach the frozen clone.
    repositories.orders = Orders;
    delete repositories.users;

    expect(instance.db.users).toBeInstanceOf(Users);
    expect(
      (instance.db as unknown as Record<string, unknown>).orders
    ).toBeUndefined();

    // pg-promise re-runs extend for every task and transaction context; run it
    // directly rather than opening a real connection.
    const { extend } = instance.db.$config.options;
    const taskContext = {} as Record<string, unknown>;
    extend?.(taskContext as never, null);
    expect(taskContext.users).toBeInstanceOf(Users);
    expect(taskContext.orders).toBeUndefined();
  });
});

describe('createDb — connection sources', () => {
  it('rejects connection combined with connectionString', () => {
    expect(() =>
      createDb({ connection: ADMIN_URL, connectionString: CELL_URL })
    ).toThrow(TypeError);
  });

  it('rejects connection combined with discrete fields', () => {
    expect(() =>
      createDb({ connection: ADMIN_URL, host: 'localhost' })
    ).toThrow(/discrete connection fields \(host\)/);
  });

  it('rejects connectionString combined with discrete fields', () => {
    expect(() =>
      createDb({ connectionString: ADMIN_URL, database: 'other' })
    ).toThrow(/discrete connection fields \(database\)/);
  });

  it('rejects a configuration with no connection source', () => {
    expect(() => createDb({ pool: { max: 5 } })).toThrow(
      /Pool options alone are not a connection/
    );
  });

  it('leaves a caller-provided connection object unmodified', () => {
    const connection = { host: 'admin.example', database: 'admin_db' };
    const before = { ...connection };
    track(createDb({ connection, pool: { max: 7 } }));
    expect(connection).toEqual(before);
  });

  it('lets explicit pool options win over pool keys inside the connection object', () => {
    const instance = track(
      createDb({
        connection: { host: 'admin.example', database: 'admin_db', max: 2 },
        pool: { max: 9 },
      })
    );
    expect(instance.info.pool.max).toBe(9);
  });

  it('converts a string connection plus pool options into an object', () => {
    const instance = track(
      createDb({ connectionString: ADMIN_URL, pool: { max: 3 } })
    );
    const cn = instance.db.$cn as Record<string, unknown>;
    expect(cn.connectionString).toBe(ADMIN_URL);
    expect(cn.max).toBe(3);
  });
});

describe('createDb — sanitized metadata', () => {
  it('freezes info and its pool', () => {
    const instance = track(
      createDb({
        host: 'admin.example',
        port: 5432,
        database: 'admin_db',
        user: 'admin',
        password: 'secret',
        ssl: true,
        pool: { max: 4, idleTimeoutMillis: 1000 },
      })
    );
    expect(Object.isFrozen(instance.info)).toBe(true);
    expect(Object.isFrozen(instance.info.pool)).toBe(true);
    expect(instance.info).toEqual({
      host: 'admin.example',
      port: 5432,
      database: 'admin_db',
      user: 'admin',
      ssl: true,
      pool: { max: 4, idleTimeoutMillis: 1000 },
    });
  });

  it('never copies the password or connection string into info', () => {
    const instance = track(
      createDb({ connectionString: ADMIN_URL, pool: { max: 1 } })
    );
    const serialized = JSON.stringify(instance.toJSON());
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain(ADMIN_URL);
    // Values that would require parsing the string are absent, not guessed.
    expect(instance.info.host).toBeUndefined();
    expect(instance.info.database).toBeUndefined();
  });
});

describe('createDb — instance isolation', () => {
  it('creates separate pg-promise roots and pools', () => {
    const admin = track(createDb({ connectionString: ADMIN_URL }));
    const cell = track(createDb({ connectionString: CELL_URL }));
    expect(admin.pgp).not.toBe(cell.pgp);
    expect(admin.db).not.toBe(cell.db);
    expect(admin.db.$pool).not.toBe(cell.db.$pool);
  });

  it('gives each instance its own repositories, db and pgp', () => {
    const admin = track(
      createDb({ connectionString: ADMIN_URL, repositories: { users: Users } })
    );
    const cell = track(
      createDb({ connectionString: CELL_URL, repositories: { users: Users } })
    );
    expect(admin.db.users).not.toBe(cell.db.users);
    expect(admin.db.users.db).toBe(admin.db);
    expect(admin.db.users.pgp).toBe(admin.pgp);
    expect(cell.db.users.pgp).toBe(cell.pgp);
  });

  it('binds forSchema results to the owning instance and caches them', () => {
    const admin = track(
      createDb({ connectionString: ADMIN_URL, repositories: { users: Users } })
    );
    const cell = track(
      createDb({ connectionString: CELL_URL, repositories: { users: Users } })
    );

    const adminTenant = admin.forSchema('tenant_a');
    expect(adminTenant.schema).toBe('tenant_a');
    expect(adminTenant.db).toBe(admin.db);
    expect(adminTenant.users.schema.dbSchema).toBe('tenant_a');
    // The other instance is untouched.
    expect(cell.db.users.schema.dbSchema).toBe('public');
    // Cached per schema name.
    expect(admin.forSchema('tenant_a')).toBe(adminTenant);
    expect(admin.forSchema('tenant_b')).not.toBe(adminTenant);
  });

  it('rejects an unsafe schema name', () => {
    const admin = track(createDb({ connectionString: ADMIN_URL }));
    expect(() => admin.forSchema('t"; DROP TABLE users; --')).toThrow();
  });

  it('routes callDb through the named instance', () => {
    const admin = track(
      createDb({ connectionString: ADMIN_URL, repositories: { users: Users } })
    );
    const cell = track(
      createDb({ connectionString: CELL_URL, repositories: { users: Users } })
    );

    const bound = callDb('users', 'tenant_a', cell);
    expect(bound.schema.dbSchema).toBe('tenant_a');
    expect(bound.pgp).toBe(cell.pgp);
    expect(bound.pgp).not.toBe(admin.pgp);
  });

  it('makes callDb honor the instance closed-state guard', async () => {
    const cell = createDb({
      connectionString: CELL_URL,
      repositories: { users: Users },
    });
    await cell.close();
    expect(() => callDb('users', 'tenant_a', cell)).toThrow(DatabaseError);
  });
});

describe('createDb — audit resolver scoping', () => {
  it('does not let a singleton resolver reach a factory instance', () => {
    setAuditActorResolver(() => 'global-actor');
    const instance = track(
      createDb({ connectionString: ADMIN_URL, repositories: { users: Users } })
    );
    // Falls back to the schema's static default, not the global resolver.
    expect(instance.db.users._resolveAuditActor()).toBe('system');
  });

  it('keeps instance resolvers from crossing instances', () => {
    const admin = track(
      createDb({
        connectionString: ADMIN_URL,
        repositories: { users: Users },
        auditActorResolver: () => 'admin-actor',
      })
    );
    const cell = track(
      createDb({
        connectionString: CELL_URL,
        repositories: { users: Users },
        auditActorResolver: () => 'cell-actor',
      })
    );
    expect(admin.db.users._resolveAuditActor()).toBe('admin-actor');
    expect(cell.db.users._resolveAuditActor()).toBe('cell-actor');
  });

  it('does not fall through to the global resolver when the scoped one returns null', () => {
    setAuditActorResolver(() => 'global-actor');
    const instance = track(
      createDb({
        connectionString: ADMIN_URL,
        repositories: { users: Users },
        auditActorResolver: () => null,
      })
    );
    expect(instance.db.users._resolveAuditActor()).toBe('system');
  });

  it('survives forSchema cloning', () => {
    const instance = track(
      createDb({
        connectionString: ADMIN_URL,
        repositories: { users: Users },
        auditActorResolver: () => 'admin-actor',
      })
    );
    const bound = instance.forSchema('tenant_a');
    expect(AUDIT_RESOLVER in bound.users).toBe(true);
    expect(bound.users._resolveAuditActor()).toBe('admin-actor');
  });

  it('stamps the models bootstrap builds', async () => {
    const seen: (string | null)[] = [];
    class Probe extends TableModel {
      constructor(db: DbConnection, pgp: IMain) {
        super(db, pgp, userSchema);
      }
      override async createTable(): Promise<null> {
        seen.push(this._resolveAuditActor());
        return null;
      }
    }
    setAuditActorResolver(() => 'global-actor');
    const instance = track(
      createDb({
        connectionString: ADMIN_URL,
        auditActorResolver: () => 'admin-actor',
      })
    );
    // A stub transaction keeps this off the network while still exercising
    // the instance's own bootstrap path.
    vi.spyOn(instance.db, 'tx').mockImplementation(((
      work: (t: DbConnection) => Promise<unknown>
    ) =>
      work({
        none: () => Promise.resolve(null),
      } as unknown as DbConnection)) as never);

    await instance.bootstrap({ models: { probe: Probe }, schema: 'tenant_a' });
    expect(seen).toEqual(['admin-actor']);
  });
});

describe('createDb — ownership is not overridable', () => {
  it('ignores db/pgp/auditActorResolver passed to migrationManager', () => {
    const admin = track(
      createDb({
        connectionString: ADMIN_URL,
        auditActorResolver: () => 'admin-actor',
      })
    );
    const foreign = track(createDb({ connectionString: CELL_URL }));
    const foreignResolver = (): string => 'foreign';
    const manager = admin.migrationManager({
      schema: 'public',
      db: foreign.db,
      pgp: foreign.pgp,
      auditActorResolver: foreignResolver,
    } as never);
    const internals = manager as unknown as {
      injectedDb: unknown;
      injectedPgp: unknown;
      auditActorResolver: (() => string | null) | null;
    };
    expect(internals.injectedDb).toBe(admin.db);
    expect(internals.injectedPgp).toBe(admin.pgp);
    expect(internals.auditActorResolver).not.toBe(foreignResolver);
    // It carries the owning instance's resolver instead.
    expect(internals.auditActorResolver?.()).toBe('admin-actor');
  });

  it('ignores db/owner/pgp passed to bootstrap', async () => {
    const admin = track(createDb({ connectionString: ADMIN_URL }));
    const foreign = track(createDb({ connectionString: CELL_URL }));
    const adminTx = vi.spyOn(admin.db, 'tx').mockResolvedValue(undefined);
    const foreignTx = vi.spyOn(foreign.db, 'tx').mockResolvedValue(undefined);

    await admin.bootstrap({
      models: {},
      db: foreign.db,
      owner: foreign.db,
      pgp: foreign.pgp,
    } as never);

    expect(adminTx).toHaveBeenCalledTimes(1);
    expect(foreignTx).not.toHaveBeenCalled();
  });
});

describe('createDb — lifecycle', () => {
  it('memoizes concurrent connect calls', async () => {
    const instance = track(createDb({ connectionString: ADMIN_URL }));
    const done = vi.fn();
    const connect = vi
      .spyOn(instance.db, 'connect')
      .mockResolvedValue({ done } as never);

    await Promise.all([instance.connect(), instance.connect()]);
    await instance.connect();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a failed connect', async () => {
    const instance = track(createDb({ connectionString: ADMIN_URL }));
    const connect = vi
      .spyOn(instance.db, 'connect')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ done: vi.fn() } as never);

    await expect(instance.connect()).rejects.toThrow('boom');
    await expect(instance.connect()).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('ends the pool exactly once for repeated and concurrent closes', async () => {
    const instance = createDb({ connectionString: ADMIN_URL });
    const end = vi.spyOn(instance.db.$pool, 'end');

    await Promise.all([instance.close(), instance.close()]);
    await instance.close();

    expect(end).toHaveBeenCalledTimes(1);
    expect(instance.isClosed).toBe(true);
  });

  it('waits for an in-flight connection before ending the pool', async () => {
    const instance = createDb({ connectionString: ADMIN_URL });
    const order: string[] = [];
    let release: (value: unknown) => void = () => undefined;
    vi.spyOn(instance.db, 'connect').mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      }).then(() => {
        order.push('connected');
        return { done: vi.fn() };
      }) as never
    );
    vi.spyOn(instance.db.$pool, 'end').mockImplementation((() => {
      order.push('ended');
      return Promise.resolve(undefined);
    }) as never);

    const connecting = instance.connect();
    const closing = instance.close();
    release(undefined);
    await Promise.all([connecting, closing]);

    expect(order).toEqual(['connected', 'ended']);
  });

  it('stays logically closed when ending the pool rejects', async () => {
    const instance = createDb({ connectionString: ADMIN_URL });
    vi.spyOn(instance.db.$pool, 'end').mockRejectedValue(
      new Error('pool failure')
    );

    await expect(instance.close()).rejects.toThrow('pool failure');
    expect(instance.isClosed).toBe(true);
  });

  it('rejects wrapper calls after closure', async () => {
    const instance = createDb({
      connectionString: ADMIN_URL,
      repositories: { users: Users },
    });
    await instance.close();

    expect(() => instance.forSchema('tenant_a')).toThrow(DatabaseError);
    expect(() => instance.migrationManager()).toThrow(DatabaseError);
    await expect(instance.connect()).rejects.toThrow(DatabaseError);
    await expect(instance.any('SELECT 1')).rejects.toThrow(DatabaseError);
    await expect(instance.transaction(async () => 1)).rejects.toThrow(
      DatabaseError
    );
    await expect(instance.migrate()).rejects.toThrow(DatabaseError);
    await expect(instance.bootstrap({ models: {} })).rejects.toThrow(
      DatabaseError
    );
  });

  it('leaves the other instance usable after one is closed', async () => {
    const admin = createDb({ connectionString: ADMIN_URL });
    const cell = track(
      createDb({ connectionString: CELL_URL, repositories: { users: Users } })
    );

    await admin.close();

    expect(admin.db.$pool.ended).toBe(true);
    expect(cell.db.$pool.ended).toBe(false);
    expect(cell.isClosed).toBe(false);
    expect(cell.forSchema('tenant_a').users.schema.dbSchema).toBe('tenant_a');
  });
});
