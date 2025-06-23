# pg-schemata

[![npm version](https://img.shields.io/npm/v/pg-schemata.svg)](https://www.npmjs.com/package/pg-schemata)
[![build status](https://img.shields.io/github/actions/workflow/status/silverstone-i/pg-schemata/ci.yml?branch=main)](https://github.com/silverstone-i/pg-schemata/actions)
[![license](https://img.shields.io/npm/l/pg-schemata.svg)](LICENSE)
[![postgresql](https://img.shields.io/badge/PostgreSQL-✔️-blue)](https://www.postgresql.org/)
[![node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)

---

A lightweight Postgres-first ORM layer built on top of [`pg-promise`](https://github.com/vitaly-t/pg-promise).  
Define your table schemas in code, generate `ColumnSets`, and get full CRUD functionality, cursor-based pagination, and multi-schema support — all without the heavy ORM overhead.

---

## ✨ Features

- Schema-driven table configuration via plain JavaScript objects
- Automatic `ColumnSet` generation for efficient pg-promise integration
- Full CRUD operations, including:
  - insert, update, delete
  - updateWhere, deleteWhere with flexible conditions
  - bulkInsert, bulkUpdate using transactions
- Cursor-based pagination (keyset pagination) with column whitelisting
- Multi-schema (PostgreSQL schemas) support
- Import data directly from spreadsheets (via selected sheet index)
- Extensible via class inheritance
- Auto-sanitization of DTOs with support for audit fields
- Consistent development and production logging via `logMessage` utility
- Typed error classes (`DatabaseError`, `SchemaDefinitionError`) for structured error handling
- LRU caching of `ColumnSet` definitions for improved performance

---

## 📦 Installation

```bash
npm install pg-promise pg-schemata
```

---

[📘 Documentation](https://silverstone-i.github.io/pg-schemata/)

---

## 📄 Basic Usage

---

## 🔎 Where Modifiers

See the supported modifiers used in `findWhere`, `updateWhere`, and other conditional methods:

➡️ [WHERE Clause Modifiers Reference](./docs/where-modifiers.md)

### 1. Define a Table Schema

```javascript
// schemas/userSchema.js
const userSchema = {
  schema: 'public',
  table: 'users',
  columns: [
    { name: 'id', type: 'serial', primaryKey: true },
    { name: 'email', type: 'text', unique: true },
    { name: 'password', type: 'text' },
    { name: 'created_at', type: 'timestamp', default: 'now()' },
  ],
};

module.exports = userSchema;
```

---

### 2. Create a Model

```javascript
// models/User.js
const TableModel = require('pg-schemata').TableModel;
const userSchema = require('../schemas/userSchema');

class User extends TableModel {
  constructor(db) {
    super(db, userSchema);
  }

  async findByEmail(email) {
    return this.db.oneOrNone(
      `SELECT * FROM ${this.schema.schema}.${this.schema.table} WHERE email = $1`,
      [email]
    );
  }
}

module.exports = User;
```

---

### 3. Perform Operations

```javascript
const { db } = require('./db'); // your pg-promise database instance
const User = require('./models/User');

const userModel = new User(db);

async function example() {
  const newUser = await userModel.create({
    email: 'test@example.com',
    password: 'secret',
  });
  const user = await userModel.findById(newUser.id);
  const updated = await userModel.update(newUser.id, {
    password: 'newpassword',
  });
  const users = await userModel.findAll({ limit: 10 });
  const deleted = await userModel.delete(newUser.id);
}
```

---

## 🛠️ Planned Enhancements

- Soft delete support
- Automatic table creation and migration from schema definitions
- Schema differencing utility to generate DDL
- Relationship handling (foreign key-aware querying and joins)
- Declarative data validation (e.g. Zod/Joi integration)
- Type-safe model generation

---


## 📘 Documentation

Documentation is generated using [MkDocs](https://www.mkdocs.org/).  
To contribute to or build the documentation site locally, follow the setup guide in [`docs/docs-setup.md`](./docs/docs-setup.md).

---

## 📚 Why `pg-schemata`?

- **Fast**: Minimal overhead on top of `pg-promise`.
- **Postgres-First**: Native Postgres features like schemas, serial IDs, and cursors.
- **Flexible**: Extend and customize models freely.
- **Simple**: Focus on the database structure you already know.

---

## 🧠 Requirements

- Node.js >= 14
- PostgreSQL >= 12
- [`pg-promise`](https://github.com/vitaly-t/pg-promise)
- [`lru-cache`](https://www.npmjs.com/package/lru-cache) (installed automatically)

---

## 📝 License

MIT

---

# 🚀 Contributions Welcome

Feel free to open issues, suggest features, or submit pull requests!
