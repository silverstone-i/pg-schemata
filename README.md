# pg-schemata

[![npm version](https://img.shields.io/npm/v/pg-schemata.svg)](https://www.npmjs.com/package/pg-schemata)
[![build status](https://img.shields.io/github/actions/workflow/status/your-username/pg-schemata/ci.yml?branch=main)](https://github.com/your-username/pg-schemata/actions)
[![license](https://img.shields.io/npm/l/pg-schemata.svg)](LICENSE)
[![postgresql](https://img.shields.io/badge/PostgreSQL-✔️-blue)](https://www.postgresql.org/)
[![node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)

---

A lightweight Postgres-first ORM layer built on top of [`pg-promise`](https://github.com/vitaly-t/pg-promise).  
Define your table schemas in code, generate `ColumnSets`, and get full CRUD functionality, cursor-based pagination, and multi-schema support — all without the heavy ORM overhead.

---

## ✨ Features

- Schema-driven table configuration
- Smart `ColumnSet` management for inserts/updates
- Base CRUD operations out of the box
- Cursor-based pagination (keyset pagination)
- Multi-schema (PostgreSQL schemas) support
- Extensible via simple class inheritance

---

## 📦 Installation

```bash
npm install pg-promise pg-schemata
```

---

## 📄 Basic Usage

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

- Soft deletes (optional)
- Auto table creation from schema definition
- Data validation before inserts/updates
- Relationship handling (joins)
- Dynamic query filters
- Schema migration helper (diff schemas and generate DDL)

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

---

## 📝 License

MIT

---

# 🚀 Contributions Welcome

Feel free to open issues, suggest features, or submit pull requests!
