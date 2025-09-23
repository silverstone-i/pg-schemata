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

const { applied, files } = await manager.applyAll();

if (applied === 0) {
  console.log('No pending migrations. Database is up to date.');
} else {
  console.log(`Applied ${applied} migration(s):`);
  for (const file of files) {
    console.log(`- ${file}`);
  }
}
