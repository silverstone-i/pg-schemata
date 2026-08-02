/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import path from 'node:path';
import pgPromise from 'pg-promise';
import type { IMain } from 'pg-promise';
import { DB } from '../../src/DB.js';
import { MigrationManager } from '../../src/migrate/MigrationManager.js';
import { defineMigration } from '../../src/migrate/defineMigration.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { DbConnection } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  '../fixtures/migrations'
);

function makeStubT(captured: string[], { legacy = false } = {}) {
  return {
    none: (sql: string) => {
      captured.push(sql);
      return Promise.resolve(null);
    },
    one: (sql: string) => {
      captured.push(sql);
      return Promise.resolve({});
    },
    oneOrNone: (sql: string) => {
      captured.push(sql);
      if (legacy && sql.includes("column_name = 'version'")) {
        return Promise.resolve({ '?column?': 1 });
      }
      return Promise.resolve(null);
    },
    any: (sql: string) => {
      captured.push(sql);
      return Promise.resolve([]);
    },
  } as unknown as DbConnection;
}

describe('MigrationManager', () => {
  let savedPgp: IMain;

  beforeEach(() => {
    columnSetCache.clear();
    savedPgp = DB.pgp;
    DB.pgp = pgp;
  });

  afterEach(() => {
    DB.pgp = savedPgp;
  });

  describe('constructor', () => {
    it('rejects modules combined with dir/moduleName', () => {
      expect(
        () => new MigrationManager({ modules: [], dir: 'migrations' })
      ).toThrow(/not both/);
      expect(
        () => new MigrationManager({ modules: [], moduleName: 'core' })
      ).toThrow(/not both/);
    });

    it('rejects duplicate module names', () => {
      const migration = defineMigration({
        id: 'a',
        up: async () => undefined,
      });
      expect(
        () =>
          new MigrationManager({
            modules: [
              { name: 'core', migrations: [migration] },
              { name: 'core', migrations: [] },
            ],
          })
      ).toThrow('Duplicate module name "core"');
    });

    it('rejects duplicate migration ids within a module', () => {
      const up = async () => undefined;
      expect(
        () =>
          new MigrationManager({
            modules: [
              {
                name: 'core',
                migrations: [
                  defineMigration({ id: 'a', up }),
                  defineMigration({ id: 'a', up }),
                ],
              },
            ],
          })
      ).toThrow('Duplicate migration id "a" in module "core"');
    });
  });

  describe('ensure()', () => {
    it('creates schema_migrations in the target schema (issue 3)', async () => {
      const captured: string[] = [];
      const manager = new MigrationManager({ schema: 'tenant_abc' });

      await manager.ensure(makeStubT(captured));

      const createSql = captured.find(sql => sql.includes('CREATE TABLE'));
      expect(createSql).toContain(
        'CREATE TABLE IF NOT EXISTS "tenant_abc"."schema_migrations"'
      );
      expect(createSql).not.toContain('"public"."schema_migrations"');
    });

    it('creates the three-part tracking shape with NOT NULL constraints', async () => {
      const captured: string[] = [];
      await new MigrationManager({}).ensure(makeStubT(captured));

      const createSql = captured.find(sql => sql.includes('CREATE TABLE'));
      expect(createSql).toContain('"schema_name" text NOT NULL');
      expect(createSql).toContain('"module_name" text NOT NULL');
      expect(createSql).toContain('"migration_id" text NOT NULL');
      expect(createSql).toContain('"hash" text NOT NULL');
      expect(createSql).toContain(
        'PRIMARY KEY ("schema_name", "module_name", "migration_id")'
      );
      expect(createSql).not.toContain('"version"');
      expect(createSql).not.toContain('"label"');
    });

    it('defaults to public', async () => {
      const captured: string[] = [];
      await new MigrationManager({}).ensure(makeStubT(captured));

      const createSql = captured.find(sql => sql.includes('CREATE TABLE'));
      expect(createSql).toContain(
        'CREATE TABLE IF NOT EXISTS "public"."schema_migrations"'
      );
    });

    it('fails with guidance when a 1.x-shape table exists', async () => {
      const captured: string[] = [];
      const manager = new MigrationManager({ schema: 'tenant_abc' });

      await expect(
        manager.ensure(makeStubT(captured, { legacy: true }))
      ).rejects.toThrow(
        /Schema "tenant_abc" contains a pg-schemata 1\.x schema_migrations table/
      );
      // Detection is a read: nothing was created or altered.
      expect(captured.some(sql => sql.includes('CREATE TABLE'))).toBe(false);
    });
  });

  describe('listPending() in directory mode', () => {
    it('accepts .mjs and .js with numeric prefixes, ignoring everything else', async () => {
      const captured: string[] = [];
      const manager = new MigrationManager({
        schema: 'tenant_abc',
        dir: FIXTURES_DIR,
      });

      const pending = await manager.listPending(makeStubT(captured));

      expect(pending.map(p => p.id)).toEqual([
        '0001_first.mjs',
        '0002_second.js',
        '0010_tenth.js',
      ]);
      expect(pending.every(p => p.module === 'default')).toBe(true);
      expect(pending.every(p => p.source === 'file')).toBe(true);
      expect(pending.every(p => /^[0-9a-f]{64}$/.test(p.checksum))).toBe(true);
    });

    it('records the configured moduleName', async () => {
      const captured: string[] = [];
      const manager = new MigrationManager({
        dir: FIXTURES_DIR,
        moduleName: 'core',
      });

      const pending = await manager.listPending(makeStubT(captured));
      expect(pending.every(p => p.module === 'core')).toBe(true);
    });
  });

  describe('listPending() in registry mode', () => {
    it('returns migrations in module array order with checksums', async () => {
      const captured: string[] = [];
      const one = defineMigration({
        id: '0001-one',
        description: 'first',
        up: async () => undefined,
      });
      const two = defineMigration({
        id: '0002-two',
        up: async () => undefined,
      });
      const manager = new MigrationManager({
        schema: 'tenant_abc',
        modules: [{ name: 'core', migrations: [one, two] }],
      });

      const pending = await manager.listPending(makeStubT(captured));

      expect(pending).toEqual([
        {
          module: 'core',
          id: '0001-one',
          description: 'first',
          checksum: one.checksum,
          source: 'registry',
        },
        {
          module: 'core',
          id: '0002-two',
          description: null,
          checksum: two.checksum,
          source: 'registry',
        },
      ]);
    });
  });
});
