# pg-schemata

[![npm version](https://img.shields.io/npm/v/pg-schemata.svg)](https://www.npmjs.com/package/pg-schemata)
[![build status](https://img.shields.io/github/actions/workflow/status/silverstone-i/pg-schemata/ci.yml?branch=main)](https://github.com/silverstone-i/pg-schemata/actions)
[![license](https://img.shields.io/npm/l/pg-schemata.svg)](LICENSE)
[![postgresql](https://img.shields.io/badge/PostgreSQL-✔️-blue)](https://www.postgresql.org/)
[![node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)

---

A lightweight Postgres-first ORM layer built on top of [`pg-promise`](https://github.com/vitaly-t/pg-promise).
Define your table schemas in code, generate `ColumnSets`, and get full CRUD, flexible WHERE builders, cursor-based pagination, and multi-schema support — without heavy ORM overhead.

---

## ✨ Features

- **Migration Management**: Full database migration support with `MigrationManager` class
  - Automatic migration tracking in `schema_migrations` table
  - Transaction-safe migration execution
  - Bootstrap utility with PostgreSQL extension support
- Written in TypeScript — ships full type declarations; opt-in typed rows via `TableModel<UserRow>` and a `Repositories` augmentation for a fully typed `db()`
- Schema-driven table configuration via plain JavaScript objects
- Automatic `ColumnSet` generation for efficient pg-promise integration
- Full CRUD operations, including:
  - insert, update, delete
  - updateWhere, deleteWhere with flexible conditions
  - bulkInsert, bulkUpdate, upsert, bulkUpsert
  - soft delete support via `deactivated_at` column (opt-in)
  - restore and purge operations for soft-deleted rows
- Rich WHERE modifiers: `$like`, `$ilike`, `$from`, `$to`, `$in`, `$eq`, `$ne`, `$is`, `$not`, nested `$and`/`$or`
- Cursor-based pagination (keyset pagination) with column whitelisting
- Multi-schema (PostgreSQL schemas) support
- Multiple independent database handles per process via `createDb()`
- Spreadsheet import and export support
- Schema-based DTO validation using Zod
- Extensible via class inheritance
- Auto-sanitization of DTOs with support for audit fields
- Consistent development and production logging via `logMessage` utility
- Typed error classes (`DatabaseError`, `SchemaDefinitionError`) for structured error handling
- LRU caching of `ColumnSet` definitions for improved performance

---

## 📦 Installation

```bash
npm install pg-schemata zod
```

`zod` is a **peer dependency** (`^4.0.0`) — pg-schemata exchanges Zod objects with your
code in both directions, so both sides must resolve the same copy. Installing against
zod 3 fails with `ERESOLVE`; upgrade your app to zod 4 first, then pg-schemata.

`pg-promise` is a direct dependency and is installed for you. Add it explicitly only if
you import from it yourself.

---

[📘 Documentation](https://silverstone-i.github.io/pg-schemata/)

---

## 📄 Basic Usage

---

## 🔎 Where Modifiers

See the supported modifiers used in `findWhere`, `updateWhere`, and other conditional methods:

➡️ [WHERE Clause Modifiers Reference](https://silverstone-i.github.io/pg-schemata/guide/where-modifiers)

### 1. Define a Table Schema

```javascript
// schemas/userSchema.js (ESM)
export const userSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true, // Adds created_at, created_by, updated_at, updated_by
  softDelete: true,
  columns: [
    { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()' },
    { name: 'email', type: 'text', notNull: true },
    { name: 'password', type: 'text', notNull: true },
  ],
  constraints: { primaryKey: ['id'], unique: [['email']] },
};
```

**💡 Tip:** `hasAuditFields` now supports an object format for custom user field types:

```javascript
hasAuditFields: {
  enabled: true,
  userFields: {
    type: 'uuid',      // Use UUID instead of default varchar(50)
    nullable: true,
    default: null
  }
}
```

**💡 Tip:** Unique constraints support both simple array format and object format with PostgreSQL 15+ `NULLS NOT DISTINCT`:

```javascript
constraints: {
  primaryKey: ['id'],
  unique: [
    ['email'],                                    // Simple format
    {                                             // Object format with options
      columns: ['tenant_id', 'email'],
      nullsNotDistinct: true,                     // Treat NULLs as equal
      name: 'uq_tenant_email'                     // Optional custom name
    }
  ]
}
```

---

### 2. Create a Model

```javascript
// models/User.js (ESM)
import { TableModel } from 'pg-schemata';
import { userSchema } from '../schemas/userSchema.js';

class User extends TableModel {
  constructor(db, pgp, logger) {
    super(db, pgp, userSchema, logger);
  }

  async findByEmail(email) {
    return this.db.oneOrNone(
      `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE email = $1`,
      [email]
    );
  }
}
```

**TypeScript:** pass a row interface to get typed CRUD results, and augment
`Repositories` once so `db()` and `callDb()` know your repository names:

```typescript
import { TableModel } from 'pg-schemata';
import type { DbConnection, Logger } from 'pg-schemata';
import type { IMain } from 'pg-promise';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

class Users extends TableModel<UserRow> {
  constructor(db: DbConnection, pgp: IMain, logger?: Logger | null) {
    super(db, pgp, userSchema, logger);
  }
}

declare module 'pg-schemata' {
  interface Repositories {
    users: Users;
  }
}

// db().users.insert(...) now returns Promise<UserRow>
```

---

### 3. Connect a Database

`createDb()` builds an independently owned database handle. Each instance owns
its own pool, repositories, schema cache, migration target, and lifecycle.

```javascript
import { createDb } from 'pg-schemata';
import { User } from './models/User.js';

const appDb = createDb({
  connectionString: process.env.DATABASE_URL,
  repositories: { users: User },
  pool: { max: 10 },
});

await appDb.connect();

const created = await appDb.db.users.insert({
  email: 'test@example.com',
  password: 'secret',
});
const one = await appDb.db.users.findById(created.id);
const list = await appDb.db.users.findAll({ limit: 10 });

await appDb.close();
```

#### Multiple databases in one process

A process can hold as many handles as it needs — for example an admin database
plus one or more cell databases:

```javascript
const adminDb = createDb({
  connectionString: process.env.ADMIN_DATABASE_URL,
  repositories: { tenants: Tenants },
});

const cellDb = createDb({
  connectionString: process.env.CELL_DATABASE_URL,
  repositories: { orders: Orders },
});

await Promise.all([adminDb.connect(), cellDb.connect()]);

const tenant = await adminDb.db.tenants.findById(tenantId);
const orders = await cellDb.db.orders.findAll({ limit: 20 });
```

Nothing is shared between instances: an operation through one never uses
another's pool, models, schema state, or migration configuration, and closing one
leaves the other fully usable. In TypeScript the repository types are inferred
per call, so `adminDb.db.tenants` and `cellDb.db.orders` are typed independently.

> **You own routing and secrets.** pg-schemata does not map tenants to cells,
> discover cells, or store credentials. Your application decides which handle to
> use and where connection details come from. `forSchema()` selects an ordinary
> PostgreSQL schema — it is not tenant routing, and it never touches
> `search_path` or pooled session state.

#### Lifecycle

`connect()` and `close()` are both idempotent and safe to call concurrently:

```javascript
await appDb.connect(); // repeated calls check the pool once
await appDb.close(); // ends only this instance's pool
await appDb.close(); // no-op
```

After `close()`, calls on the instance throw
`DatabaseError('Database instance has been closed')`.

> ⚠️ Never call `pgp.end()` to shut down one handle — it destroys **every**
> pg-promise pool in the process, including other instances. Use
> `instance.close()` (or `DB.close()` for the singleton).

Handles are meant to be long-lived: pg-promise keeps closed database objects in
process-global bookkeeping until process shutdown, so do not create one per
request.

#### Compatibility: the `DB` singleton

The original singleton still works and is now a documented **default instance**
built with the same factory:

```javascript
import { DB, db } from 'pg-schemata';

DB.init(process.env.DATABASE_URL, { users: User });
const one = await db().users.findById(id);
await DB.close(); // additive: closes the default instance and resets it
```

`DB.init()` connects exactly one database. Reach for `createDb()` when you need
more than one.

---

### 4. Database Migrations

pg-schemata provides a complete migration management system:

```javascript
// migrations/0001_initial.mjs
import { bootstrap } from 'pg-schemata';
import { models } from '../src/models/index.js';

export async function up({ schema }) {
  // Bootstrap creates all tables and enables common extensions
  await bootstrap({ models, schema });
}
```

```javascript
// migrate.mjs - Run migrations against one selected database
const { applied } = await cellDb.migrate({
  schema: 'public',
  dir: './migrations',
});
console.log(`Applied ${applied.length} migration(s)`);
```

`migrate()` always targets the instance it is called on — the database, its
pg-promise root, and its audit resolver cannot be overridden through the
options — so a migration cannot reach another handle by accident. Pass
`dryRun: true` to preview. The standalone `MigrationManager` still works and
falls back to the `DB` singleton:

```javascript
import { MigrationManager } from 'pg-schemata';

const manager = new MigrationManager({ schema: 'public', dir: './migrations' });
const { applied } = await manager.applyAll();
```

➡️ **[Complete Migration Tutorial](./Examples/migration-tutorial/README.md)**

---

## 🛠️ Planned Enhancements

See the [Roadmap](./prd/PRD.md#8-roadmap) in the PRD. Suggestions welcome!!! 🙂

---

## 📘 Documentation

Full documentation is available at [silverstone-i.github.io/pg-schemata](https://silverstone-i.github.io/pg-schemata/).

To build the docs locally:

```bash
npm run docs:dev      # local dev server
npm run docs:build    # production build
npm run docs:preview  # preview the build
```

---

## 📚 Why `pg-schemata`?

- **Fast**: Minimal overhead on top of `pg-promise`.
- **Postgres-First**: Native Postgres features like schemas, serial IDs, and cursors.
- **Flexible**: Extend and customize models freely.
- **Simple**: Focus on the database structure you already know.

---

## 🧠 Requirements

- Node.js >= 20
- PostgreSQL >= 13
- `zod` >= 4 — a peer dependency you install alongside pg-schemata

---

## 📝 License

MIT

---

# 🚀 Contributions Welcome

Feel free to open issues, suggest features, or submit pull requests!
