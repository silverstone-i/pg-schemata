# Getting Started

`pg-schemata` is an ESM-first Node.js package that provides a lightweight, PostgreSQL-first ORM layer built on [pg-promise](https://github.com/vitaly-t/pg-promise).

## Requirements

- Node.js 18 or newer
- PostgreSQL 12 or newer
- `pg-promise` as a peer dependency

## Install

```bash
npm install pg-schemata pg-promise
```

## Define a schema

A schema is a plain JavaScript object that describes your table — columns, types, constraints, and behavior flags.

```js
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
```

## Create a model

Extend `TableModel` and pass the schema to `super()`.

```js
import { TableModel } from 'pg-schemata';

export class Users extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, usersSchema, logger);
  }
}
```

## Initialize the database

Use `DB.init()` once at startup with a connection string and a repository map. Each repository is automatically attached to the database instance via pg-promise's `extend` event.

```js
import { DB, db } from 'pg-schemata';
import { Users } from './models/Users.js';

const repositories = {
  users: Users,
};

DB.init(process.env.DATABASE_URL, repositories);
```

After initialization, access repositories through `db()`:

```js
const database = db();

// Create the table
await database.users.createTable();

// Insert a record
const alice = await database.users.insert({
  email: 'alice@example.com',
  first_name: 'Alice',
});

// Query records
const activeUsers = await database.users.findWhere(
  [{ is_active: true }],
  'AND',
  { orderBy: 'email' }
);

// Update a record
const updated = await database.users.update(alice.id, {
  last_name: 'Liddell',
});

// Soft delete
await database.users.removeWhere({ id: alice.id });
```

## What to read next

- [Schema Definition](/guide/schema-definition) — understand the schema object in depth
- [Models](/guide/models) — learn about QueryModel vs TableModel
- [CRUD Operations](/guide/crud-operations) — the full insert/update/delete API
