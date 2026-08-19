/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// Two independently created database handles in one process, the shape NAP
// uses for an admin database plus a cell database.
//
// Set ADMIN_DATABASE_URL and CELL_DATABASE_URL to exercise genuinely separate
// databases. When they are absent the suite falls back to DATABASE_URL with two
// UUID-named schemas, which still proves instance isolation: migrations must
// reach only the selected handle's target, and closing one handle must leave
// the other fully usable.

import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/Database.js';
import TableModel from '../../src/TableModel.js';
import type { DbConnection, TableSchema } from '../../src/schemaTypes.js';
import type { IMain } from 'pg-promise';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL!;
const CELL_URL = process.env.CELL_DATABASE_URL ?? process.env.DATABASE_URL!;

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  '../fixtures/migrations'
);

const uniqueSchema = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

const tenantSchema: TableSchema = {
  dbSchema: 'public',
  table: 'multi_db_tenants',
  columns: [
    { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()' },
    { name: 'name', type: 'text', notNull: true },
  ],
  constraints: { primaryKey: ['id'] },
};

class Tenants extends TableModel {
  constructor(db: DbConnection, pgp: IMain) {
    super(db, pgp, tenantSchema);
  }
}

describe('multiple database instances (integration)', () => {
  it('keeps pools, migrations and lifecycles independent', async () => {
    const adminSchema = uniqueSchema('admin');
    const cellSchema = uniqueSchema('cell');

    const adminDb = createDb({
      connectionString: ADMIN_URL,
      repositories: { tenants: Tenants },
    });
    const cellDb = createDb({
      connectionString: CELL_URL,
      repositories: { tenants: Tenants },
    });

    try {
      expect(adminDb.db.$pool).not.toBe(cellDb.db.$pool);

      await adminDb.connect();
      await cellDb.connect();
      // Repeated connects are safe.
      await adminDb.connect();

      await adminDb.none(
        `DROP SCHEMA IF EXISTS "${adminSchema}" CASCADE; CREATE SCHEMA "${adminSchema}"`
      );
      await cellDb.none(
        `DROP SCHEMA IF EXISTS "${cellSchema}" CASCADE; CREATE SCHEMA "${cellSchema}"`
      );

      // Migrations run through the admin handle only.
      const result = await adminDb.migrate({
        schema: adminSchema,
        dir: FIXTURES_DIR,
        moduleName: 'fixtures',
      });
      expect(result.applied.length).toBeGreaterThan(0);

      const adminTracking = await adminDb.oneOrNone<{ ok: number }>(
        `SELECT 1 AS ok FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'schema_migrations'`,
        [adminSchema]
      );
      expect(adminTracking).not.toBeNull();

      const cellTracking = await cellDb.oneOrNone<{ ok: number }>(
        `SELECT 1 AS ok FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'schema_migrations'`,
        [cellSchema]
      );
      expect(cellTracking).toBeNull();

      // The cell handle owns its own tables, built through its own pool.
      await cellDb.bootstrap({
        models: { tenants: Tenants },
        schema: cellSchema,
      });

      await adminDb.close();
      expect(adminDb.isClosed).toBe(true);

      // A real query through the still-open cell handle.
      const cellTenants = cellDb.forSchema(cellSchema).tenants;
      const inserted = await cellTenants.insert({ name: 'acme' });
      expect(inserted.name).toBe('acme');
      const found = await cellDb.one<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${cellSchema}"."multi_db_tenants"`
      );
      expect(found.count).toBe('1');

      // Closing the admin instance twice stays safe.
      await adminDb.close();
    } finally {
      if (!cellDb.isClosed) {
        await cellDb
          .none(`DROP SCHEMA IF EXISTS "${cellSchema}" CASCADE`)
          .catch(() => undefined);
      }
      const cleanup = createDb({ connectionString: ADMIN_URL });
      await cleanup
        .none(`DROP SCHEMA IF EXISTS "${adminSchema}" CASCADE`)
        .catch(() => undefined);
      await cleanup.close();
      await adminDb.close();
      await cellDb.close();
    }
  });
});
