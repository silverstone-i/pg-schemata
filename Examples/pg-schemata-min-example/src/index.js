import 'dotenv/config';
import { db } from './db.js';

async function main() {
  await db.users.createTable();
  const alice = await db.users.insert({ email: 'alice@example.com', first_name: 'Alice' });
  const rows = await db.users.findWhere([{ is_active: true }], 'AND', { orderBy: 'email' });
  const updated = await db.users.update(alice.id, { last_name: 'Liddell' });
  await db.users.removeWhere({ id: alice.id });
  console.log({ inserted: alice, count: rows.length, updated });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});