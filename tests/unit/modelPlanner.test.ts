/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect } from 'vitest';
import type { IMain } from 'pg-promise';
import {
  topoSort,
  isTableModel,
  getModelKey,
  getTableDependencies,
  orderModels,
  resolveModuleOrder,
} from '../../src/migrate/modelPlanner.js';
import type { TableModelLike } from '../../src/migrate/modelPlanner.js';
import type {
  DbConnection,
  RepositoryCtor,
  TableSchema,
} from '../../src/schemaTypes.js';
import type { ModuleDescriptor } from '../../src/migrate/types.js';

const stubDb = {} as DbConnection;
const stubPgp = {} as IMain;

/** Builds a minimal table-model instance for orderModels tests. */
function fakeModel(
  table: string,
  fks: { table: string; schema?: string }[] = [],
  dbSchema = 'tenant_x'
): TableModelLike {
  return {
    schema: {
      dbSchema,
      table,
      constraints: {
        foreignKeys: fks.map(fk => ({
          references: { table: fk.table, schema: fk.schema },
        })),
      },
    },
    createTable: async () => null,
  };
}

/** Builds a repository class for resolveModuleOrder tests. */
function fakeCtor(
  table: string,
  fks: { table: string; schema?: string }[] = []
): RepositoryCtor {
  return class {
    schema: TableModelLike['schema'];
    constructor() {
      this.schema = {
        dbSchema: 'placeholder',
        table,
        constraints: {
          foreignKeys: fks.map(fk => ({
            references: { table: fk.table, schema: fk.schema },
          })),
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
      return null;
    }
  };
}

describe('topoSort', () => {
  it('orders a linear chain dependencies-first', () => {
    const graph = new Map<string, string[]>([
      ['c', ['b']],
      ['b', ['a']],
      ['a', []],
    ]);
    expect(topoSort(graph, 'foreign-key')).toEqual(['a', 'b', 'c']);
  });

  it('handles a diamond', () => {
    const graph = new Map<string, string[]>([
      ['d', ['b', 'c']],
      ['b', ['a']],
      ['c', ['a']],
      ['a', []],
    ]);
    const sorted = topoSort(graph, 'foreign-key');
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'));
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('c'));
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('d'));
    expect(sorted.indexOf('c')).toBeLessThan(sorted.indexOf('d'));
  });

  it('skips self-edges', () => {
    const graph = new Map<string, string[]>([['a', ['a']]]);
    expect(topoSort(graph, 'foreign-key')).toEqual(['a']);
  });

  it('ignores dependencies outside the graph', () => {
    const graph = new Map<string, string[]>([['a', ['external.table']]]);
    expect(topoSort(graph, 'foreign-key')).toEqual(['a']);
  });

  it('preserves insertion order among independent nodes', () => {
    const graph = new Map<string, string[]>([
      ['z', []],
      ['m', []],
      ['a', []],
    ]);
    expect(topoSort(graph, 'module')).toEqual(['z', 'm', 'a']);
  });

  it('throws on a cycle with the cycle path in the message', () => {
    const graph = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    expect(() => topoSort(graph, 'foreign-key')).toThrow(
      'Cyclic foreign-key dependency detected: a -> b -> c -> a'
    );
  });

  it('uses the kind word in the cycle message', () => {
    const graph = new Map<string, string[]>([
      ['x', ['y']],
      ['y', ['x']],
    ]);
    expect(() => topoSort(graph, 'module')).toThrow(
      'Cyclic module dependency detected: x -> y -> x'
    );
  });
});

describe('isTableModel / getModelKey / getTableDependencies', () => {
  it('recognizes the table-model shape', () => {
    expect(isTableModel(fakeModel('users'))).toBe(true);
    expect(isTableModel(null)).toBe(false);
    expect(isTableModel({})).toBe(false);
    expect(isTableModel({ createTable: () => null })).toBe(false);
  });

  it('keys models as lowercased schema.table', () => {
    expect(getModelKey(fakeModel('Users', [], 'Tenant_A'))).toBe(
      'tenant_a.users'
    );
  });

  it('qualifies bare FK targets with references.schema, then own dbSchema', () => {
    const model = fakeModel('orders', [
      { table: 'users' },
      { table: 'countries', schema: 'admin' },
      { table: 'admin.tenants' },
    ]);
    expect(getTableDependencies(model)).toEqual([
      'tenant_x.users',
      'admin.countries',
      'admin.tenants',
    ]);
  });

  it('dedupes and drops FKs without a references.table', () => {
    const model: TableModelLike = {
      schema: {
        dbSchema: 'tenant_x',
        table: 'orders',
        constraints: {
          foreignKeys: [
            { references: { table: 'users' } },
            { references: { table: 'users' } },
            { references: undefined },
          ],
        },
      },
      createTable: async () => null,
    };
    expect(getTableDependencies(model)).toEqual(['tenant_x.users']);
  });
});

describe('orderModels', () => {
  it('orders parents before children', () => {
    const users = fakeModel('users');
    const orders = fakeModel('orders', [{ table: 'users' }]);
    const items = fakeModel('items', [{ table: 'orders' }]);
    const sorted = orderModels({ items, orders, users });
    expect(sorted.map(m => m.schema.table)).toEqual([
      'users',
      'orders',
      'items',
    ]);
  });

  it('ignores cross-schema references to tables outside the set', () => {
    const orders = fakeModel('orders', [
      { table: 'countries', schema: 'admin' },
    ]);
    expect(orderModels({ orders })).toEqual([orders]);
  });

  it('throws on a cyclic FK dependency with the path', () => {
    const a = fakeModel('a', [{ table: 'b' }]);
    const b = fakeModel('b', [{ table: 'a' }]);
    expect(() => orderModels({ a, b })).toThrow(
      /Cyclic foreign-key dependency detected: tenant_x\.a -> tenant_x\.b -> tenant_x\.a/
    );
  });

  it('filters out non-table values', () => {
    const users = fakeModel('users');
    expect(orderModels({ users, notAModel: 42 })).toEqual([users]);
  });
});

describe('resolveModuleOrder', () => {
  it('orders modules by cross-module FK ownership regardless of array order', () => {
    const modules: ModuleDescriptor[] = [
      {
        name: 'projects',
        models: { projects: fakeCtor('projects', [{ table: 'users' }]) },
        migrations: [],
      },
      {
        name: 'auth',
        models: { users: fakeCtor('users') },
        migrations: [],
      },
    ];
    expect(resolveModuleOrder(modules, 'tenant_x', stubDb, stubPgp)).toEqual([
      'auth',
      'projects',
    ]);
  });

  it('preserves caller order among independent modules', () => {
    const modules: ModuleDescriptor[] = [
      { name: 'b', models: { t: fakeCtor('b_table') }, migrations: [] },
      { name: 'a', models: { t: fakeCtor('a_table') }, migrations: [] },
    ];
    expect(resolveModuleOrder(modules, 'tenant_x', stubDb, stubPgp)).toEqual([
      'b',
      'a',
    ]);
  });

  it('ignores same-module and external FK targets', () => {
    const modules: ModuleDescriptor[] = [
      {
        name: 'core',
        models: {
          users: fakeCtor('users'),
          orders: fakeCtor('orders', [
            { table: 'users' },
            { table: 'elsewhere.unknown' },
          ]),
        },
        migrations: [],
      },
    ];
    expect(resolveModuleOrder(modules, 'tenant_x', stubDb, stubPgp)).toEqual([
      'core',
    ]);
  });

  it('throws on duplicate module names', () => {
    const modules: ModuleDescriptor[] = [
      { name: 'core', migrations: [] },
      { name: 'core', migrations: [] },
    ];
    expect(() =>
      resolveModuleOrder(modules, 'tenant_x', stubDb, stubPgp)
    ).toThrow('Duplicate module name "core"');
  });

  it('throws on a cyclic module dependency with the path', () => {
    const modules: ModuleDescriptor[] = [
      {
        name: 'a',
        models: { m: fakeCtor('a_table', [{ table: 'b_table' }]) },
        migrations: [],
      },
      {
        name: 'b',
        models: { m: fakeCtor('b_table', [{ table: 'a_table' }]) },
        migrations: [],
      },
    ];
    expect(() =>
      resolveModuleOrder(modules, 'tenant_x', stubDb, stubPgp)
    ).toThrow('Cyclic module dependency detected: a -> b -> a');
  });

  it('propagates model construction errors', () => {
    const Exploding = class {
      constructor() {
        throw new Error('boom');
      }
    } as unknown as RepositoryCtor;
    const modules: ModuleDescriptor[] = [
      { name: 'core', models: { boom: Exploding }, migrations: [] },
    ];
    expect(() =>
      resolveModuleOrder(modules, 'tenant_x', stubDb, stubPgp)
    ).toThrow('boom');
  });
});
