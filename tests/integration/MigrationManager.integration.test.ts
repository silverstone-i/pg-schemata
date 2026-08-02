/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { IMain } from 'pg-promise';
import DB from '../../src/DB.js';
import TableModel from '../../src/TableModel.js';
import { MigrationManager } from '../../src/migrate/MigrationManager.js';
import { defineMigration } from '../../src/migrate/defineMigration.js';
import type {
  MigrationContext,
  ModuleDescriptor,
} from '../../src/migrate/types.js';
import type { DbConnection } from '../../src/schemaTypes.js';

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  '../fixtures/migrations'
);

const uniqueSchema = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

class Users extends TableModel {
  constructor(db: DbConnection, pgp: IMain) {
    super(db, pgp, {
      dbSchema: 'placeholder',
      table: 'mig_users',
      hasAuditFields: false,
      softDelete: false,
      columns: [
        {
          name: 'id',
          type: 'uuid',
          default: 'gen_random_uuid()',
          notNull: true,
        },
        { name: 'email', type: 'text', notNull: true },
      ],
      constraints: { primaryKey: ['id'] },
    });
  }
}

class Projects extends TableModel {
  constructor(db: DbConnection, pgp: IMain) {
    super(db, pgp, {
      dbSchema: 'placeholder',
      table: 'mig_projects',
      hasAuditFields: false,
      softDelete: false,
      columns: [
        {
          name: 'id',
          type: 'uuid',
          default: 'gen_random_uuid()',
          notNull: true,
        },
        { name: 'owner_id', type: 'uuid', notNull: true },
      ],
      constraints: {
        primaryKey: ['id'],
        foreignKeys: [
          {
            type: 'ForeignKey',
            columns: ['owner_id'],
            references: { table: 'mig_users', columns: ['id'] },
          },
        ],
      },
    });
  }
}

interface ModelWithCreate {
  createTable: () => Promise<unknown>;
}

const authMigration = defineMigration({
  id: '0001-auth-tables',
  description: 'create users',
  up: async ({ models }: MigrationContext) => {
    await (models.users as ModelWithCreate).createTable();
  },
});

const projectsMigration = defineMigration({
  id: '0001-projects-tables',
  description: 'create projects',
  up: async ({ models }: MigrationContext) => {
    await (models.projects as ModelWithCreate).createTable();
  },
});

// Deliberately listed projects-first: the module-level FK sort must flip it.
const registryModules = (): ModuleDescriptor[] => [
  {
    name: 'projects',
    models: { projects: Projects },
    migrations: [projectsMigration],
  },
  {
    name: 'auth',
    models: { users: Users },
    migrations: [authMigration],
  },
];

const db = DB.init(process.env.DATABASE_URL!, {}).db;
const pgp = DB.pgp;

const createdSchemas: string[] = [];

async function freshSchema(prefix: string): Promise<string> {
  const name = uniqueSchema(prefix);
  createdSchemas.push(name);
  await db.none(
    `DROP SCHEMA IF EXISTS "${name}" CASCADE; CREATE SCHEMA "${name}"`
  );
  return name;
}

async function trackingRows(schema: string) {
  return db.any(
    `SELECT schema_name, module_name, migration_id, hash, description
     FROM "${schema}"."schema_migrations" ORDER BY module_name, migration_id`
  );
}

describe('MigrationManager (integration)', () => {
  beforeAll(async () => {
    await db.one('SELECT 1 AS ok');
  });

  afterAll(async () => {
    for (const schema of createdSchemas) {
      await db.none(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    pgp.end();
  });

  it('applies registry migrations with three-part tracking and FK module order', async () => {
    const schema = await freshSchema('mig_registry');
    const manager = new MigrationManager({
      schema,
      modules: registryModules(),
    });

    const result = await manager.applyAll();

    // Module order flipped by the FK sort despite [projects, auth] input.
    expect(result.moduleOrder).toEqual(['auth', 'projects']);
    expect(result.dryRun).toBe(false);
    expect(result.applied.map(m => m.id)).toEqual([
      '0001-auth-tables',
      '0001-projects-tables',
    ]);

    const rows = await trackingRows(schema);
    expect(rows).toEqual([
      {
        schema_name: schema,
        module_name: 'auth',
        migration_id: '0001-auth-tables',
        hash: authMigration.checksum,
        description: 'create users',
      },
      {
        schema_name: schema,
        module_name: 'projects',
        migration_id: '0001-projects-tables',
        hash: projectsMigration.checksum,
        description: 'create projects',
      },
    ]);

    // Both tables landed in the target schema.
    const tables = await db.any(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema]
    );
    const names = tables.map((r: { table_name: string }) => r.table_name);
    expect(names).toContain('mig_users');
    expect(names).toContain('mig_projects');
  });

  it('is idempotent on re-run', async () => {
    const schema = await freshSchema('mig_rerun');
    const manager = new MigrationManager({
      schema,
      modules: registryModules(),
    });

    await manager.applyAll();
    const before = await trackingRows(schema);

    const second = await new MigrationManager({
      schema,
      modules: registryModules(),
    }).applyAll();

    expect(second.pending).toEqual([]);
    expect(second.applied).toEqual([]);
    expect(await trackingRows(schema)).toEqual(before);
  });

  it('aborts with a clear error when an applied migration was edited', async () => {
    const schema = await freshSchema('mig_hash');
    await new MigrationManager({
      schema,
      modules: [
        { name: 'auth', models: { users: Users }, migrations: [authMigration] },
      ],
    }).applyAll();

    const edited = defineMigration({
      id: '0001-auth-tables',
      description: 'create users',
      up: async ({ models }: MigrationContext) => {
        await (models.users as ModelWithCreate).createTable();
        return 'edited body';
      },
    });
    const manager = new MigrationManager({
      schema,
      modules: [
        { name: 'auth', models: { users: Users }, migrations: [edited] },
      ],
    });

    await expect(manager.applyAll()).rejects.toThrow(
      new RegExp(
        `Migration checksum mismatch in schema "${schema}", module "auth", migration "0001-auth-tables"`
      )
    );
    // Nothing was recorded by the failed run.
    expect(await trackingRows(schema)).toHaveLength(1);
  });

  it('rolls back everything when a later migration fails', async () => {
    const schema = await freshSchema('mig_rollback');
    const failing = defineMigration({
      id: '0002-fails',
      up: async () => {
        throw new Error('deliberate failure');
      },
    });
    const manager = new MigrationManager({
      schema,
      modules: [
        {
          name: 'auth',
          models: { users: Users },
          migrations: [authMigration, failing],
        },
      ],
    });

    await expect(manager.applyAll()).rejects.toThrow('deliberate failure');

    // The whole tx rolled back: no tracking table, no users table.
    const tables = await db.any(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema]
    );
    expect(tables).toEqual([]);
  });

  it('dry-run reports pending without writing anything', async () => {
    const schema = await freshSchema('mig_dry');
    const manager = new MigrationManager({
      schema,
      modules: registryModules(),
    });

    const result = await manager.applyAll({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.pending.map(m => m.id)).toEqual([
      '0001-auth-tables',
      '0001-projects-tables',
    ]);
    expect(result.applied).toEqual([]);

    const tables = await db.any(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema]
    );
    expect(tables).toEqual([]);

    // After a real run, dry-run reports nothing pending.
    await manager.applyAll();
    const after = await new MigrationManager({
      schema,
      modules: registryModules(),
    }).applyAll({ dryRun: true });
    expect(after.pending).toEqual([]);
  });

  it('applies directory-scanned .mjs and .js files under the default module', async () => {
    const schema = await freshSchema('mig_dir');
    const manager = new MigrationManager({ schema, dir: FIXTURES_DIR });

    const result = await manager.applyAll();

    expect(result.moduleOrder).toEqual(['default']);
    expect(result.applied.map(m => m.id)).toEqual([
      '0001_first.mjs',
      '0002_second.js',
      '0010_tenth.js',
    ]);

    const rows = await trackingRows(schema);
    expect(rows.map((r: { module_name: string }) => r.module_name)).toEqual([
      'default',
      'default',
      'default',
    ]);

    const tables = await db.any(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'fixture%'`,
      [schema]
    );
    expect(tables).toHaveLength(3);

    // Re-run is idempotent in directory mode too.
    const second = await new MigrationManager({
      schema,
      dir: FIXTURES_DIR,
    }).applyAll();
    expect(second.applied).toEqual([]);
  });

  it('records a custom moduleName in directory mode', async () => {
    const schema = await freshSchema('mig_dirmod');
    await new MigrationManager({
      schema,
      dir: FIXTURES_DIR,
      moduleName: 'core',
    }).applyAll();

    const rows = await trackingRows(schema);
    expect(
      rows.every((r: { module_name: string }) => r.module_name === 'core')
    ).toBe(true);
  });

  it('detects a legacy 1.x tracking table and aborts without touching it', async () => {
    const schema = await freshSchema('mig_legacy');
    await db.none(
      `CREATE TABLE "${schema}"."schema_migrations" (
         schema_name text NOT NULL,
         version integer NOT NULL,
         hash text NOT NULL,
         label text,
         applied_at timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (schema_name, version)
       )`
    );
    await db.none(
      `INSERT INTO "${schema}"."schema_migrations" (schema_name, version, hash, label)
       VALUES ($1, 1, 'abc', '0001_old.mjs')`,
      [schema]
    );

    const manager = new MigrationManager({
      schema,
      modules: registryModules(),
    });
    await expect(manager.applyAll()).rejects.toThrow(
      /1\.x schema_migrations table/
    );

    // The legacy table and its row are untouched.
    const rows = await db.any(
      `SELECT version FROM "${schema}"."schema_migrations"`
    );
    expect(rows).toEqual([{ version: 1 }]);
  });

  it('passes a working context: schema-bound models and ensureExtensions', async () => {
    const schema = await freshSchema('mig_ctx');
    const seen: Record<string, unknown> = {};
    const contextMigration = defineMigration({
      id: '0001-context',
      up: async (context: MigrationContext) => {
        seen.schema = context.schema;
        seen.module = context.module;
        seen.hasPgp = typeof context.pgp.as?.name === 'function';
        await context.ensureExtensions(['pgcrypto']);
        const users = context.models.users as Users;
        await users.createTable();
        await users.insert({ email: 'ctx@example.com' });
        seen.boundSchema = users.schema.dbSchema;
      },
    });

    await new MigrationManager({
      schema,
      modules: [
        {
          name: 'auth',
          models: { users: Users },
          migrations: [contextMigration],
        },
      ],
    }).applyAll();

    expect(seen.schema).toBe(schema);
    expect(seen.module).toBe('auth');
    expect(seen.hasPgp).toBe(true);
    expect(seen.boundSchema).toBe(schema);

    const rows = await db.any(`SELECT email FROM "${schema}"."mig_users"`);
    expect(rows).toEqual([{ email: 'ctx@example.com' }]);
  });
});
