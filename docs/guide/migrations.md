# Migrations

pg-schemata includes a `MigrationManager` for discovering, applying, and tracking versioned migration scripts.

## Overview

- Migration files live in a directory (default: `migrations/`)
- Files are named with a numeric prefix: `0001_create_users.mjs`, `0002_add_roles.mjs`
- Each file exports an `up()` function
- Migrations run in a single transaction — if any fails, all are rolled back
- An advisory lock prevents concurrent migration runs on the same schema
- Applied migrations are tracked in a `schema_migrations` table with SHA-256 hashes

## Writing migration files

Create `.mjs` files with a numeric prefix and an exported `up` function:

```js
// migrations/0001_create_users.mjs
export async function up({ db, schema }) {
  await db.none(`
    CREATE TABLE IF NOT EXISTS "${schema}"."users" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      first_name VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
```

The `up` function receives:

| Parameter | Type | Description |
|---|---|---|
| `db` | `ITask` | A pg-promise transaction object — all queries run inside the transaction |
| `schema` | `string` | The PostgreSQL schema name being migrated |

## Using bootstrap for initial setup

For the first migration, you can use `bootstrap()` to create all tables from your existing model definitions:

```js
// migrations/0001_bootstrap.mjs
import { bootstrap } from 'pg-schemata';
import { Users } from '../src/models/Users.js';
import { Products } from '../src/models/Products.js';

export async function up({ db, schema }) {
  await bootstrap({
    models: { users: Users, products: Products },
    schema,
    extensions: ['pgcrypto'],
    db, // pass the transaction to avoid nested transactions
  });
}
```

## Running migrations

```js
import { MigrationManager } from 'pg-schemata';

const manager = new MigrationManager({
  schema: 'public',       // PostgreSQL schema to target
  dir: 'migrations',      // directory containing migration files
});

const result = await manager.applyAll();
console.log(result);
// { applied: 2, files: ['0001_create_users.mjs', '0002_add_roles.mjs'] }
```

## MigrationManager API

### Constructor

```js
new MigrationManager({ schema, dir })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `schema` | `string` | `'public'` | PostgreSQL schema to target |
| `dir` | `string` | `'migrations'` | Directory containing migration files |

### applyAll()

Applies all pending migrations in a single transaction. Returns `{ applied, files }`.

The method:
1. Acquires a PostgreSQL advisory lock (per schema) to prevent concurrent runs
2. Ensures the `schema_migrations` table exists
3. Discovers pending migration files
4. Runs each `up()` function in version order
5. Records each migration with its SHA-256 file hash

### listPending(t)

Returns an array of pending migration files (those with version > current applied version).

```js
const pending = await manager.listPending(db());
// [{ file: '0003_add_indexes.mjs', version: 3, full: '/abs/path/...' }]
```

### currentVersion(t)

Returns the highest applied migration version, or `0` if none have been applied.

### ensure(t)

Creates the `schema_migrations` table if it doesn't exist.

## File naming convention

Migration files must match the pattern: `{number}_{label}.mjs`

- The numeric prefix determines execution order
- Use zero-padded numbers for consistent sorting: `0001`, `0002`, etc.
- The label is descriptive: `create_users`, `add_email_index`
- Files must use `.mjs` extension (ESM dynamic import)

## Integrity tracking

Each applied migration is recorded with a SHA-256 hash of the file contents. This allows detection of modifications to previously applied migrations.
