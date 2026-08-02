# Migrations

pg-schemata includes a `MigrationManager` for discovering, applying, and tracking migrations. Migrations are forward-only — there is no rollback surface — and every applied migration is content-hashed and verified on later runs.

## Overview

- Two input modes, chosen at construction: a **module registry** (ordered arrays of `defineMigration()` objects per module) or a **directory scan** (`0001_name.mjs` / `0001_name.js` files)
- Tracking is per `(schema_name, module_name, migration_id)` in the target schema's `schema_migrations` table
- Module execution order is derived from a topological foreign-key sort across modules; cycles throw with the cycle path in the message
- Migrations run in a single transaction — if any fails, all are rolled back
- An advisory lock prevents concurrent migration runs on the same schema
- Content hashes are **verified on every run** — editing an applied migration aborts the run; write a new migration instead

## Registry mode

Declare each migration with `defineMigration()` and group them into modules:

```js
import { defineMigration, MigrationManager } from 'pg-schemata';
import { Users, Projects } from './models/index.js';

const createUsers = defineMigration({
  id: '202608020001-create-users',
  description: 'initial auth tables',
  async up({ models }) {
    await models.users.createTable();
  },
});

const manager = new MigrationManager({
  schema: 'tenant_a',
  modules: [
    { name: 'auth', models: { users: Users }, migrations: [createUsers] },
    { name: 'projects', models: { projects: Projects }, migrations: [...] },
  ],
});

const result = await manager.applyAll();
```

Within a module, the migrations array order is authoritative — it is never re-sorted. Across modules, execution order comes from the FK sort: if a `projects` model references a table owned by `auth`, the `auth` module runs first regardless of array order.

`defineMigration({ id, description?, up })` returns a frozen object with a `checksum` — `sha256(id + description + up.toString())` — so an edited `up()` body is detected on the next run.

## The up() context

Each migration's `up()` receives:

| Property           | Type       | Description                                                                                 |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------- |
| `schema`           | `string`   | The PostgreSQL schema being migrated                                                        |
| `module`           | `string`   | The owning module's name (`'default'` in directory mode)                                    |
| `db`               | `ITask`    | The surrounding pg-promise transaction — all queries run inside it                          |
| `pgp`              | `IMain`    | The pg-promise root library (formatting helpers etc.)                                       |
| `logger`           | `Logger`   | The logger passed to the manager, or `null`                                                 |
| `models`           | `object`   | The module's models, constructed on the transaction and bound to `schema` via `forSchema()` |
| `ensureExtensions` | `function` | `await ensureExtensions(['pgcrypto'])` — CREATE EXTENSION IF NOT EXISTS                     |

## Directory mode

Create `.mjs` or `.js` files with a numeric prefix and an exported `up` function:

```js
// migrations/0001_create_users.mjs
export async function up({ db, schema }) {
  await db.none(`
    CREATE TABLE IF NOT EXISTS "${schema}"."users" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE
    )
  `);
}
```

```js
const manager = new MigrationManager({
  schema: 'public',
  dir: 'migrations', // default
  moduleName: 'default', // module_name recorded for scanned files
});
await manager.applyAll();
```

- The numeric prefix determines execution order; use zero-padded numbers (`0001`, `0002`)
- Both `.mjs` and `.js` extensions are accepted (ESM dynamic import)
- The `migration_id` recorded is the file name; the hash is the SHA-256 of the file bytes

Registry and directory mode are mutually exclusive on one manager — pass `modules` or `dir`/`moduleName`, not both.

## Dry run

```js
const preview = await manager.applyAll({ dryRun: true });
// { schema, dryRun: true, moduleOrder, pending: [...], applied: [] }
```

A dry run acquires the lock, verifies hashes when the tracking table exists, and reports pending migrations — but executes nothing and writes nothing (it does not even create the tracking table).

## Using bootstrap for initial setup

`bootstrap()` creates all tables from your model definitions, ordered parent-first by their foreign keys:

```js
import { bootstrap } from 'pg-schemata';

export async function up({ db, schema }) {
  await bootstrap({
    models: { users: Users, products: Products },
    schema,
    extensions: ['pgcrypto'],
    db, // pass the transaction to avoid nested transactions
  });
}
```

## MigrationManager API

### Constructor

| Option       | Type                 | Default        | Description                                    |
| ------------ | -------------------- | -------------- | ---------------------------------------------- |
| `schema`     | `string`             | `'public'`     | PostgreSQL schema to target                    |
| `modules`    | `ModuleDescriptor[]` | —              | Registry mode: modules with ordered migrations |
| `dir`        | `string`             | `'migrations'` | Directory mode: directory containing files     |
| `moduleName` | `string`             | `'default'`    | Directory mode: module_name recorded for files |
| `logger`     | `Logger \| null`     | `null`         | Passed into contexts and model construction    |

### applyAll({ dryRun? })

Applies all pending migrations in a single transaction. Returns:

```ts
{
  schema: string;
  dryRun: boolean;
  moduleOrder: string[];            // resolved execution order
  pending: PendingMigrationInfo[];  // pending at the start of the run
  applied: PendingMigrationInfo[];  // === pending, or [] on dry run
}
```

The method:

1. Acquires a PostgreSQL advisory lock (per schema) to prevent concurrent runs
2. Fails if a 1.x-shape `schema_migrations` table is found (see below)
3. Ensures the `schema_migrations` table exists (skipped on dry run)
4. **Verifies stored hashes** for every already-applied migration in the catalog — a mismatch aborts before anything executes
5. Runs each pending `up()` in order and records it with its hash

### listPending(t?)

Returns pending migrations across both modes, in execution order (also verifies hashes):

```js
const pending = await manager.listPending();
// [{ module: 'auth', id: '202608020001-create-users', description, checksum, source: 'registry' }]
```

### ensure(t)

Creates the `schema_migrations` table if it doesn't exist (fails on a legacy-shape table).

## Integrity tracking

Each applied migration is recorded with its content hash — file bytes in directory mode, `sha256(id + description + up.toString())` in registry mode. On every later run the stored hash is compared against the current one; a mismatch fails the run with an error naming the schema, module, and migration id. Applied migrations are immutable: a correction is a new migration, never an edit.

## Upgrading from 1.x

pg-schemata 2.0.0 changed migration tracking from `(schema_name, version)` to `(schema_name, module_name, migration_id)`. The 1.x `schema_migrations` shape is incompatible, and the manager detects it and aborts with an error — nothing is modified automatically.

To upgrade a database that ran 1.x migrations:

1. Back up the existing `schema_migrations` table (e.g. `ALTER TABLE ... RENAME TO schema_migrations_v1`).
2. Re-run the migrator. It creates the 2.x table.
3. Re-baseline: either write your existing DDL state as a fresh initial migration, or insert rows for already-applied migrations by hand (`schema_name`, `module_name`, `migration_id`, `hash`, `description`) so they are not re-executed. For directory mode, `migration_id` is the file name and `hash` is the SHA-256 of the file bytes — the same values 1.x stored in `version`/`hash` keyed rows.

Other 2.0.0 migration changes: `currentVersion()` was removed (tracking is an applied-set, not a high-water mark), the old `PendingMigration` type was replaced by `PendingMigrationInfo`, and the `up()` context gained `module`, `pgp`, `logger`, `models`, and `ensureExtensions`.
