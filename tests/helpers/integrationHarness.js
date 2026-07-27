// ===============================
// tests/helpers/integrationHarness.js
// ===============================

import 'dotenv/config';
import crypto from 'crypto';
import DB from '../../src/DB.js';
import { createTableSQL } from '../../src/utils/schemaBuilder.js';
import TableModel from '../../src/TableModel.js';

export async function createTestContext(schema, seed = null) {
  const uniqueSchemaName = `${schema.dbSchema}_${crypto.randomUUID().replace(/-/g, '')}`;
  const schemaCopy = { ...schema, dbSchema: uniqueSchemaName };

  class Model extends TableModel {
    constructor(db, pgp) {
      super(db, pgp, schemaCopy);
    }
  }

  const { db, pgp } = await DB.init(process.env.DATABASE_URL, { model: Model });

  // console.log(`🧪 Using schema: ${schemaCopy.dbSchema}`);
  await db.none(`DROP SCHEMA IF EXISTS "${schemaCopy.dbSchema}" CASCADE; CREATE SCHEMA IF NOT EXISTS "${schemaCopy.dbSchema}"`);
  // Build the table from the model's normalized schema (audit + soft-delete
  // columns applied). The harness previously passed schemaCopy here and only
  // worked because the constructor used to mutate it as a side effect.
  await db.none(createTableSQL(db.model.schema));

  if (typeof seed === 'function') {
    await seed(db);
  }

  async function teardown() {
    await db.none(`DROP SCHEMA IF EXISTS "${schemaCopy.dbSchema}" CASCADE`);
    await pgp.end();
  }

  return { ctx: { db }, model: db.model, teardown, pgp };
}
