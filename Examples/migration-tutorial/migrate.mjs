import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './src/db.js';
import { MigrationManager } from 'pg-schemata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initDb();

const manager = new MigrationManager({
  schema: 'public',
  dir: path.join(__dirname, 'migrations'),
});

// applyAll() returns { schema, dryRun, moduleOrder, pending, applied }.
// `applied` is an array of PendingMigrationInfo — { module, id, description,
// checksum, source, file } — not a count.
const { schema, applied } = await manager.applyAll();

if (applied.length === 0) {
  console.log(`No pending migrations. Schema "${schema}" is up to date.`);
} else {
  console.log(`Applied ${applied.length} migration(s) to "${schema}":`);
  for (const migration of applied) {
    console.log(`- [${migration.module}] ${migration.id}`);
  }
}
