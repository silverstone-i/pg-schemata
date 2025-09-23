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
  await db.none(createTableSQL(schemaCopy));

  if (typeof seed === 'function') {
    await seed(db);
  }

  async function teardown() {
    await db.none(`DROP SCHEMA IF EXISTS "${schemaCopy.dbSchema}" CASCADE`);
    await pgp.end();
  }

  return { ctx: { db }, model: db.model, teardown, pgp };
}
