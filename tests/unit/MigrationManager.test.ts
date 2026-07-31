/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import pgPromise from 'pg-promise';
import type { IMain } from 'pg-promise';
import { DB } from '../../src/DB.js';
import { MigrationManager } from '../../src/migrate/MigrationManager.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { DbConnection } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

function makeStubT(captured: string[]) {
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
      return Promise.resolve(null);
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

  it('ensure() creates schema_migrations in the target schema (issue 3)', async () => {
    const captured: string[] = [];
    const manager = new MigrationManager({ schema: 'tenant_abc' });

    await manager.ensure(makeStubT(captured));

    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "tenant_abc"."schema_migrations"'
    );
    expect(captured[0]).not.toContain('"public"."schema_migrations"');
  });

  it('creates schema_migrations with NOT NULL constraints (N6)', async () => {
    const captured: string[] = [];
    await new MigrationManager({}).ensure(makeStubT(captured));

    expect(captured[0]).toContain('"schema_name" text NOT NULL');
    expect(captured[0]).toContain('"version" integer NOT NULL');
    expect(captured[0]).toContain('"hash" text NOT NULL');
  });

  it('ensure() defaults to public', async () => {
    const captured: string[] = [];
    const manager = new MigrationManager({});

    await manager.ensure(makeStubT(captured));

    expect(captured[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "public"."schema_migrations"'
    );
  });

  it('currentVersion() reads from the same schema ensure() wrote to', async () => {
    const captured: string[] = [];
    const manager = new MigrationManager({ schema: 'tenant_abc' });
    const t = {
      ...makeStubT(captured),
      oneOrNone: (sql: string, params: unknown) => {
        captured.push(sql);
        expect(params).toEqual(['tenant_abc']);
        return Promise.resolve({ v: 4 });
      },
    } as unknown as DbConnection;

    await manager.ensure(t);
    const version = await manager.currentVersion(t);

    expect(version).toBe(4);
    expect(captured[0]).toContain('"tenant_abc"."schema_migrations"');
    expect(captured[1]).toContain('"tenant_abc"."schema_migrations"');
  });
});
