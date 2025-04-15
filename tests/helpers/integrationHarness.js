// ===============================
// tests/helpers/integrationHarness.js
// ===============================

import 'dotenv/config';
import DB from '../../src/DB.js';
import { createTableSQL } from '../../src/utils/schemaBuilder.js';
import BaseModel from '../../src/BaseModel.js';

class TestUserModel extends BaseModel {
  constructor(db, pgp) {
    super(db, pgp, testUserSchema);
  }
}


export async function createTestContext(schema, seed = null) {

 class Model extends BaseModel {
    constructor(db, pgp) {
      super(db, pgp, schema);
    }
  }

  // Initialize the database
  const repositories = {
    model: Model,
  };

  const { db, pgp } = await DB.init(process.env.DATABASE_URL, repositories);

  const schemaName = schema.dbSchema;
  const tableName = schema.table;
  const fullTableRef = `"${schemaName}"."${tableName}"`;

  await db.none(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  await db.none(`DROP TABLE IF EXISTS ${fullTableRef}`);
  await db.none(createTableSQL(schema));

  if (typeof seed === 'function') {
    await seed(db);
  }

  async function teardown() {
    await db.none(`DROP TABLE IF EXISTS ${fullTableRef}`);
    await pgp.end();
  }

  return { db, model: db.model, teardown };
}
