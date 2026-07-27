import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import pgPromise from 'pg-promise';
import { DB } from '../../src/DB.js';
import { MigrationManager } from '../../src/migrate/MigrationManager.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';

const pgp = pgPromise({});

function makeStubT(captured) {
  return {
    none: sql => { captured.push(sql); return Promise.resolve(null); },
    one: sql => { captured.push(sql); return Promise.resolve({}); },
    oneOrNone: sql => { captured.push(sql); return Promise.resolve(null); },
  };
}

describe('MigrationManager', () => {
  let savedPgp;

  beforeEach(() => {
    columnSetCache.clear();
    savedPgp = DB.pgp;
    DB.pgp = pgp;
  });

  afterEach(() => {
    DB.pgp = savedPgp;
  });

  it('ensure() creates schema_migrations in the target schema (issue 3)', async () => {
    const captured = [];
    const manager = new MigrationManager({ schema: 'tenant_abc' });

    await manager.ensure(makeStubT(captured));

    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain('CREATE TABLE IF NOT EXISTS "tenant_abc"."schema_migrations"');
    expect(captured[0]).not.toContain('"public"."schema_migrations"');
  });

  it('ensure() defaults to public', async () => {
    const captured = [];
    const manager = new MigrationManager({});

    await manager.ensure(makeStubT(captured));

    expect(captured[0]).toContain('CREATE TABLE IF NOT EXISTS "public"."schema_migrations"');
  });

  it('currentVersion() reads from the same schema ensure() wrote to', async () => {
    const captured = [];
    const manager = new MigrationManager({ schema: 'tenant_abc' });
    const t = {
      ...makeStubT(captured),
      oneOrNone: (sql, params) => { captured.push(sql); expect(params).toEqual(['tenant_abc']); return Promise.resolve({ v: 4 }); },
    };

    await manager.ensure(t);
    const version = await manager.currentVersion(t);

    expect(version).toBe(4);
    expect(captured[0]).toContain('"tenant_abc"."schema_migrations"');
    expect(captured[1]).toContain('"tenant_abc"."schema_migrations"');
  });
});
