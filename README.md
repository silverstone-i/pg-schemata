# pg-schemata

[![npm version](https://img.shields.io/npm/v/pg-schemata.svg)](https://www.npmjs.com/package/pg-schemata)
[![build status](https://img.shields.io/github/actions/workflow/status/silverstone-i/pg-schemata/ci.yml?branch=main)](https://github.com/silverstone-i/pg-schemata/actions)
[![license](https://img.shields.io/npm/l/pg-schemata.svg)](LICENSE)
[![postgresql](https://img.shields.io/badge/PostgreSQL-✔️-blue)](https://www.postgresql.org/)
[![node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)

---

A lightweight Postgres-first ORM layer built on top of [`pg-promise`](https://github.com/vitaly-t/pg-promise).
Define your table schemas in code, generate `ColumnSets`, and get full CRUD, flexible WHERE builders, cursor-based pagination, and multi-schema support — without heavy ORM overhead.

---

## ✨ Features

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
npm install pg-schemata pg-promise
```

---

[📘 Documentation](https://silverstone-i.github.io/pg-schemata/)

---

## 📄 Basic Usage

---

## 🔎 Where Modifiers

See the supported modifiers used in `findWhere`, `updateWhere`, and other conditional methods:

➡️ [WHERE Clause Modifiers Reference](https://silverstone-i.github.io/pg-schemata/where-modifiers/)

### 1. Define a Table Schema

```javascript
// schemas/userSchema.js (ESM)
export const userSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  softDelete: true,
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'email', type: 'text', notNull: true },
    { name: 'password', type: 'text', notNull: true },
  ],
  constraints: { primaryKey: ['id'], unique: [['email']] },
};
```

---

### 2. Create a Model

```javascript
// models/User.js (ESM)
import { TableModel } from 'pg-schemata';
import { userSchema } from '../schemas/userSchema.js';

export class User extends TableModel {
  constructor(db, pgp, logger) {
    super(db, pgp, userSchema, logger);
  }
}
```

---

### 3. Initialize DB and Perform Operations

```javascript
import { DB, db } from 'pg-schemata';
import { User } from './models/User.js';

// Initialize with a pg connection string/object and attach repositories
DB.init(process.env.DATABASE_URL, { users: User });

async function example() {
  const created = await db().users.insert({ email: 'test@example.com', password: 'secret' });
  const one = await db().users.findById(created.id);
  const updated = await db().users.update(created.id, { password: 'newpassword' });
  const list = await db().users.findAll({ limit: 10 });
  const removed = await db().users.delete(created.id);
}
```

---

## 🛠️ Planned Enhancements

See [Planned Enhancements](./design_docs/PlannedEnhancements.md). Suggestions welcome!!! 🙂

---

## 📘 Documentation

Documentation is generated using [MkDocs](https://www.mkdocs.org/).  
To contribute to or build the documentation site locally, see the guide: [Docs Setup](https://silverstone-i.github.io/pg-schemata/docs-setup/).

---

## 📚 Why `pg-schemata`?

- **Fast**: Minimal overhead on top of `pg-promise`.
- **Postgres-First**: Native Postgres features like schemas, serial IDs, and cursors.
- **Flexible**: Extend and customize models freely.
- **Simple**: Focus on the database structure you already know.

---

## 🧠 Requirements

- Node.js >= 16
- PostgreSQL >= 12
- [`pg-promise`](https://github.com/vitaly-t/pg-promise)
- [`lru-cache`](https://www.npmjs.com/package/lru-cache) (installed automatically)

---

## 📝 License

MIT

---

# 🚀 Contributions Welcome

Feel free to open issues, suggest features, or submit pull requests!
