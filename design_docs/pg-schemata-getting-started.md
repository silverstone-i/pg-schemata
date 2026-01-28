# pg-schemata (ESM) — Practical Getting Started

This guide shows how to install **pg-schemata**, wire it into a Node.js ESM project, and use its two core building blocks — **DB** (singleton) and **repositories** (your table models). It also includes a minimal working project you can download below.

## Install

```bash
npm i pg-schemata pg-promise pg dotenv
```

> Requires Node 18+ and PostgreSQL.

## Concepts in 60 seconds

- **DB**: a singleton wrapper around *pg‑promise*; you call `DB.init(connection, repositories)` once, and then use `DB.db` and `DB.pgp` everywhere.
- **Repository**: a class per table, typically extending `TableModel`. Repositories are attached to `DB.db` automatically at init so you can call `DB.db.users.findAll()`, etc.
- **Schema-first**: table columns + constraints are declared as a JS object; `TableModel` can generate DDL (create table), Zod validators, and gives CRUD helpers.

## Project wiring (ESM)

**/src/db.js** (singleton init)

```js
// ESM
import { DB } from 'pg-schemata';
import repositories from './repositories.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

if (!DB.db) {
  DB.init(DATABASE_URL, repositories);
}

export const db = DB.db;
export const pgp = DB.pgp;
```

**/src/repositories.js** (attach your models)

```js
import { Users } from './models/Users.js';

export default {
  users: Users,
};
```

**/src/models/Users.js** (table model + schema)

```js
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

**/src/index.js** (basic usage)

```js
import 'dotenv/config';
import { db } from './db.js';

async function main() {
  // Create table if needed:
  await db.users.createTable();

  // Insert
  const alice = await db.users.insert({ email: 'alice@example.com', first_name: 'Alice' });

  // Query
  const rows = await db.users.findWhere([{ is_active: true }], 'AND', { orderBy: 'email' });

  // Update
  const updated = await db.users.update(alice.id, { last_name: 'Liddell' });

  // Soft delete
  await db.users.removeWhere({ id: alice.id });

  console.log({ inserted: alice, count: rows.length, updated });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

## QueryModel vs TableModel — what you actually use

**QueryModel** (read helpers)
- `findAll({ limit, offset })`
- `findById(id)` / `findByIdIncludingDeactivated(id)`
- `findWhere(conditions[], joinType='AND', opts)` / `findOneBy(...)`
- `findAfterCursor(cursor, limit, orderBy[], { descending, filters })` (cursor pagination)
- `exists(conditions)`, `countWhere(conditions)`, `countAll({ includeDeactivated })`
- `buildValuesClause(data)`, `buildWhereClause(...)`, `buildCondition(...)` (power users)

**TableModel** (read + write)
- `insert(dto)`, `update(id, dto)`, `delete(id)`
- `deleteWhere(where)`, `updateWhere(where, updates)`
- `upsert(dto, conflictColumns, updateColumns?)`
- `bulkInsert(records, returning?)`, `bulkUpdate(records, returning?)`, `bulkUpsert(...)`
- Soft delete utilities: `removeWhere(where)`, `restoreWhere(where)`, `purgeSoftDeleteWhere(where)`, `purgeSoftDeleteById(id)`
- Utilities: `truncate()`, `createTable()`, `exportToSpreadsheet(path)`, `importFromSpreadsheet(path)`

## WHERE condition syntax (quick reference)

```js
// Match: name ILIKE 'al%'
await db.users.findWhere([{ name: { $ilike: 'al%' } }]);
// Range: created_at between dates
await db.users.findWhere([{ created_at: { $from: '2025-01-01', $to: '2025-12-31' } }]);
// IN lists, IS NULL / NOT NULL, and nesting
await db.users.findWhere([
  { role: { $in: ['user','admin'] } },
  { $or: [{ deleted_at: { $is: null } }, { archived_at: { $not: null } }] },
]);
```

## Errors and validation

- DB errors are wrapped as `DatabaseError` (unique, FK, check, invalid input).
- DTOs are validated by auto‑generated Zod schemas (insert/update) from your table schema.
- Soft‑delete adds `deactivated_at`; reads skip deactivated rows by default. Set `includeDeactivated:true` to include them.

---

## Schema Types (d.ts) — how schemas are built

Below is a **practical** outline of the type shapes used when defining a table schema. It mirrors the `schemaTypes.d.ts` intent and matches what `TableModel`/DDL expect.

### `TableSchema` (shape)

```ts
type TableSchema = {
  /** Postgres schema name (e.g., 'public', or tenant-specific) */
  dbSchema: string;
  /** Table name */
  table: string;

  /**
   * Adds created_at/_by and updated_at/_by columns + triggers in DDL
   *
   * Supports two formats:
   * - boolean: true/false (backward compatible, defaults to varchar(50) for user fields)
   * - object: {
   *     enabled: boolean,
   *     userFields?: {
   *       type?: string,      // e.g., 'uuid', 'int', 'varchar(100)' (default: 'varchar(50)')
   *       nullable?: boolean, // default: true
   *       default?: any       // default: null
   *     }
   *   }
   *
   * Examples:
   *   hasAuditFields: true  // varchar(50) user fields
   *   hasAuditFields: { enabled: true, userFields: { type: 'uuid' } }
   */
  hasAuditFields?: boolean | {
    enabled: boolean;
    userFields?: {
      type?: string;
      nullable?: boolean;
      default?: any;
    };
  };

  /** Adds deactivated_at and switches deletes to soft-delete helpers */
  softDelete?: boolean;

  /** Column definitions */
  columns: ColumnDef[];

  /** Keys, FKs, checks */
  constraints?: {
    /** Single or composite primary key */
    primaryKey?: string[];
    /** One or more unique constraints (each entry can be composite) */
    unique?: string[][];
    /** Foreign key constraints */
    foreignKeys?: Array<{
      columns: string[];
      references: {
        schema?: string;   // default: same as dbSchema
        table: string;
        columns: string[]; // usually single-column
        onDelete?: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
      };
      name?: string;       // optional explicit constraint name
    }>;
    /** Optional check constraints (raw SQL) */
    checks?: string[];
  };

  /** Optional indexes */
  indexes?: Array<{
    name?: string;
    columns: string[];     // can be expressions if needed
    unique?: boolean;
    where?: string;        // partial index predicate
    using?: 'btree' | 'hash' | 'gin' | 'gist';
  }>;
};
```

### `ColumnDef` (shape)

```ts
type ColumnDef = {
  name: string;
  /** PostgreSQL type literal, e.g. 'uuid', 'varchar(255)', 'timestamp with time zone' */
  type: string;
  notNull?: boolean;
  default?: string;        // raw SQL default, e.g. "gen_random_uuid()", "now()", "'N/A'"
  immutable?: boolean;     // prevents updates (enforced in update helpers)
  references?: {
    schema?: string;
    table: string;
    column?: string;       // default usually 'id'
    onDelete?: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
  };
  /** free-form per-column metadata recognized by pg-schemata utilities */
  colProps?: {
    cnd?: boolean;         // common: "canonical id" marker used by some repos
    [k: string]: unknown;
  };
};
```

> Tip: You can keep schemas **declarative** and let `TableModel.createTable()` generate the DDL. Zod insert/update validators are auto-generated from `columns` unless you provide your own.

### Example — two tables with FK and soft delete

```js
// Tenants
const tenantsSchema = {
  dbSchema: 'public',
  table: 'tenants',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'tenant_code', type: 'varchar(64)', notNull: true },
    { name: 'name', type: 'varchar(200)', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['tenant_code']],
  },
};

// Users referencing tenants, soft-deletable
const usersSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  softDelete: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'tenant_id', type: 'uuid', notNull: true,
      references: { table: 'tenants', columns: ['id'], onDelete: 'CASCADE' } },
    { name: 'email', type: 'varchar(255)', notNull: true },
    { name: 'first_name', type: 'varchar(100)' },
    { name: 'last_name', type: 'varchar(100)' },
    { name: 'is_active', type: 'boolean', default: 'true', notNull: true },
    // when softDelete: TableModel adds deactivated_at in DDL
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['tenant_id', 'email']],
    foreignKeys: [
      { columns: ['tenant_id'], references: { table: 'tenants', columns: ['id'], onDelete: 'CASCADE' } }
    ]
  },
  indexes: [
    { columns: ['tenant_id', 'email'], unique: true },
    { columns: ['email'] }
  ]
};
```

### Example — Custom Audit Fields with UUID

The new object format for `hasAuditFields` allows you to customize the user tracking columns (`created_by`, `updated_by`):

```js
// Accounts with UUID-based user tracking
const accountsSchema = {
  dbSchema: 'public',
  table: 'accounts',
  hasAuditFields: {
    enabled: true,
    userFields: {
      type: 'uuid',        // Use UUID instead of varchar(50)
      nullable: true,      // Optional (default: true)
      default: null        // Optional (default: null)
    }
  },
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', notNull: true },
    { name: 'account_name', type: 'varchar(255)', notNull: true },
    { name: 'balance', type: 'numeric(15,2)', notNull: true, default: 0 },
  ],
  constraints: {
    primaryKey: ['id'],
  },
};

// Transactions with integer user IDs
const transactionsSchema = {
  dbSchema: 'public',
  table: 'transactions',
  hasAuditFields: {
    enabled: true,
    userFields: { type: 'int' }  // Partial config, uses defaults for nullable and default
  },
  columns: [
    { name: 'id', type: 'bigserial', notNull: true },
    { name: 'amount', type: 'numeric(10,2)', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
  },
};
```

The generated SQL for `accountsSchema` will include:
```sql
"created_at" timestamptz DEFAULT now(),
"created_by" uuid,
"updated_at" timestamptz DEFAULT now(),
"updated_by" uuid,
```

> **Backward Compatibility**: The boolean format (`hasAuditFields: true` or `hasAuditFields: false`) continues to work as before, using `varchar(50)` for user fields.

### Using these schemas with TableModel

```js
import { TableModel } from 'pg-schemata';

export class Tenants extends TableModel {
  constructor(db, pgp, logger = null) { super(db, pgp, tenantsSchema, logger); }
}
export class Users extends TableModel {
  constructor(db, pgp, logger = null) { super(db, pgp, usersSchema, logger); }
}
```

**Why this matters:**  
- The `constraints` and `indexes` parts drive the generated DDL.  
- `softDelete: true` enables `removeWhere/restoreWhere/purge*` helpers and excludes deactivated rows in queries (unless `includeDeactivated` is true).  
- Zod validators derive required vs optional from `notNull`, and infer types from each column’s `type`.

## Minimal working project

Download the zip: **pg-schemata-min-example.zip** (see link below).  
It includes `package.json`, `.env.example`, and the files shown above.

---

### Next steps
- Add more repositories (`orders`, `tenants`, etc.) to `/src/repositories.js`.
- Put migrations/DDL in a proper migration tool if desired; or call `createTable()` during bootstrap.
- See the full docs site for method signatures and WHERE modifiers.