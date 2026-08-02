/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import pgPromise from 'pg-promise';
import type { IMain } from 'pg-promise';
import { DB } from '../../src/DB.js';
import { bootstrap } from '../../src/migrate/bootstrap.js';
import type { DbConnection, RepositoryCtor } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

/** Repository class whose createTable records its table name. */
function recordingCtor(
  table: string,
  created: string[],
  fks: { table: string }[] = []
): RepositoryCtor {
  return class {
    schema: {
      dbSchema: string;
      table: string;
      constraints: { foreignKeys: { references: { table: string } }[] };
    };
    constructor() {
      this.schema = {
        dbSchema: 'placeholder',
        table,
        constraints: {
          foreignKeys: fks.map(fk => ({ references: { table: fk.table } })),
        },
      };
    }
    forSchema(name: string): unknown {
      const clone = Object.create(
        Object.getPrototypeOf(this) as object
      ) as this;
      Object.assign(clone, this);
      clone.schema = { ...this.schema, dbSchema: name };
      return clone;
    }
    async createTable(): Promise<null> {
      created.push(table);
      return null;
    }
  };
}

function makeStubT(): DbConnection {
  return {
    none: () => Promise.resolve(null),
  } as unknown as DbConnection;
}

describe('bootstrap', () => {
  let savedPgp: IMain;

  beforeEach(() => {
    savedPgp = DB.pgp;
    DB.pgp = pgp;
  });

  afterEach(() => {
    DB.pgp = savedPgp;
  });

  it('creates tables parent-first regardless of insertion order', async () => {
    const created: string[] = [];
    await bootstrap({
      models: {
        // Deliberately child-before-parent insertion order.
        items: recordingCtor('items', created, [{ table: 'orders' }]),
        orders: recordingCtor('orders', created, [{ table: 'users' }]),
        users: recordingCtor('users', created),
      },
      schema: 'tenant_x',
      extensions: [],
      db: makeStubT(),
    });

    expect(created).toEqual(['users', 'orders', 'items']);
  });

  it('throws on cyclic FK dependencies', async () => {
    const created: string[] = [];
    await expect(
      bootstrap({
        models: {
          a: recordingCtor('a', created, [{ table: 'b' }]),
          b: recordingCtor('b', created, [{ table: 'a' }]),
        },
        schema: 'tenant_x',
        extensions: [],
        db: makeStubT(),
      })
    ).rejects.toThrow(/Cyclic foreign-key dependency detected/);
  });

  it('rejects a non-object models option', async () => {
    await expect(
      bootstrap({ models: null as unknown as Record<string, RepositoryCtor> })
    ).rejects.toThrow('models option must be an object');
  });
});
