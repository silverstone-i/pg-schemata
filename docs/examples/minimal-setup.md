# Minimal Setup

A complete working example showing how to set up pg-schemata from scratch.

## Project structure

```
my-app/
  src/
    db.js              # Database initialization
    repositories.js    # Repository map
    models/
      Users.js         # User model
    index.js           # Application entry point
  .env                 # Database connection
  package.json
```

## 1. Define a model

```js
// src/models/Users.js
import { TableModel } from 'pg-schemata';

const usersSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  softDelete: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'email', type: 'varchar(255)', notNull: true },
    { name: 'first_name', type: 'varchar(100)' },
    { name: 'last_name', type: 'varchar(100)' },
    { name: 'is_active', type: 'boolean', default: 'true', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['email']],
  },
};

export class Users extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, usersSchema, logger);
  }
}
```

## 2. Create a repository map

```js
// src/repositories.js
import { Users } from './models/Users.js';

export default {
  users: Users,
};
```

## 3. Initialize the database

```js
// src/db.js
import { DB } from 'pg-schemata';
import repositories from './repositories.js';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

if (!DB.db) {
  DB.init(DATABASE_URL, repositories);
}

export const db = DB.db;
export const pgp = DB.pgp;
```

## 4. Use the models

```js
// src/index.js
import 'dotenv/config';
import { db } from './db.js';

async function main() {
  // Create the table
  await db.users.createTable();

  // Insert a record
  const alice = await db.users.insert({
    email: 'alice@example.com',
    first_name: 'Alice',
  });

  // Query records
  const rows = await db.users.findWhere(
    [{ is_active: true }],
    'AND',
    { orderBy: 'email' }
  );

  // Update a record
  const updated = await db.users.update(alice.id, {
    last_name: 'Liddell',
  });

  // Soft delete
  await db.users.removeWhere({ id: alice.id });

  console.log({ inserted: alice, count: rows.length, updated });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

## 5. Environment

```bash
# .env
DATABASE_URL=postgres://user:password@localhost:5432/mydb
```

## 6. Run

```bash
npm install pg-schemata pg-promise dotenv
node --env-file=.env src/index.js
```
