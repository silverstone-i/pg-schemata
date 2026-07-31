/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// ===============================
// tests/helpers/integrationHarness.js
// ===============================

import 'dotenv/config';
import crypto from 'crypto';
import DB from '../../src/DB.js';
import type { ExtendedDb } from '../../src/DB.js';
import { createTableSQL } from '../../src/utils/schemaBuilder.js';
import TableModel from '../../src/TableModel.js';
import type { DbConnection, TableSchema } from '../../src/schemaTypes.js';
import type { IMain } from 'pg-promise';

export interface TestContext {
  ctx: { db: ExtendedDb };
  model: TableModel;
  teardown: () => Promise<void>;
  pgp: IMain;
}

export async function createTestContext(
  schema: TableSchema,
  seed: ((db: ExtendedDb) => unknown) | null = null
): Promise<TestContext> {
  const uniqueSchemaName = `${schema.dbSchema}_${crypto.randomUUID().replace(/-/g, '')}`;
  const schemaCopy = { ...schema, dbSchema: uniqueSchemaName };

  class Model extends TableModel {
    constructor(db: DbConnection, pgp: IMain) {
      super(db, pgp, schemaCopy);
    }
  }

  const { db, pgp } = DB.init(process.env.DATABASE_URL!, {
    model: Model,
  });
  // The Repositories interface is intentionally left empty for consumers to
  // augment, so the attached `model` repository is accessed via a local cast.
  const dbAny = db as any;

  // console.log(`🧪 Using schema: ${schemaCopy.dbSchema}`);
  await db.none(
    `DROP SCHEMA IF EXISTS "${schemaCopy.dbSchema}" CASCADE; CREATE SCHEMA IF NOT EXISTS "${schemaCopy.dbSchema}"`
  );
  // Build the table from the model's normalized schema (audit + soft-delete
  // columns applied). The harness previously passed schemaCopy here and only
  // worked because the constructor used to mutate it as a side effect.
  await db.none(createTableSQL(dbAny.model.schema));

  if (typeof seed === 'function') {
    await seed(db);
  }

  async function teardown() {
    await db.none(`DROP SCHEMA IF EXISTS "${schemaCopy.dbSchema}" CASCADE`);
    pgp.end();
  }

  return { ctx: { db }, model: dbAny.model as TableModel, teardown, pgp };
}
