import { bootstrap } from 'pg-schemata';
import { models } from '../src/models/index.js';

// `db` comes from the migration context and is the transaction MigrationManager
// already opened. Passing it through keeps every CREATE TABLE inside that one
// transaction — without it, bootstrap() calls DB.db.tx() and opens a second,
// independent transaction, so a later failure in this migration would roll back
// the migration record while leaving the tables behind.
export async function up({ db, schema }) {
  await bootstrap({ models, schema, db });
}
