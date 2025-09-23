# Order Management Migration Tutorial

This tutorial walks through building a tiny order-management service that uses
**pg-schemata** migrations. The example covers two practical phases:

1. Bootstrapping an app with three related tables (`customers`, `orders`, `order_items`).
2. Shipping a follow-up migration that adds new fields to an existing table
   as part of regular maintenance.

The finished sample lives in `Examples/migration-tutorial/`. Follow the steps
below to recreate it from scratch or run it directly.

---

## Prerequisites

- Node.js 18+
- PostgreSQL 13+ with a database you can connect to
- `DATABASE_URL` environment variable that points at that database (e.g.
  `postgres://postgres:postgres@localhost:5432/pg_schemata_demo`)

> **Tip**: For local testing you can create a fresh database with `createdb pg_schemata_demo`.

---

## 1. Project Setup

1. Create a working directory and initialise a Node project.

   ```bash
   mkdir order-service && cd order-service
   npm init -y
   npm install pg pg-promise pg-schemata
   npm pkg set type=module
   ```

2. Copy the contents of `Examples/migration-tutorial/` into your project. The
   folder already includes:

   - `package.json` with a `migrate` script (`npm run migrate`)
   - `src/` with model, schema, and DB helpers
   - Two migration files under `migrations/`
   - A `migrate.mjs` entry point that applies migrations

3. Export `DATABASE_URL` before running any scripts:

   ```bash
   export DATABASE_URL=postgres://postgres:postgres@localhost:5432/pg_schemata_demo
   ```

---

## 2. Define Schemas and Models

The app tracks customers, the orders they place, and line items inside each
order.

### `customers`

`src/schemas/customersSchema.js`

```javascript
export const customersSchema = {
  dbSchema: 'public',
  table: 'customers',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'email', type: 'varchar(255)', notNull: true },
    { name: 'full_name', type: 'varchar(200)', notNull: true },
    { name: 'phone', type: 'varchar(50)' },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['email']],
  },
};
```

### `orders`

Start with the following schema when you first build the system (notice the
absence of `status` columns—we will add them later):

```javascript
// src/schemas/ordersSchema.js (initial version)
export const ordersSchema = {
  dbSchema: 'public',
  table: 'orders',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'customer_id', type: 'uuid', notNull: true },
    { name: 'order_number', type: 'varchar(20)', notNull: true },
    { name: 'order_total', type: 'numeric(12,2)', notNull: true, default: '0' },
    { name: 'placed_at', type: 'timestamptz', notNull: true, default: 'now()' },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['order_number']],
    foreignKeys: [
      {
        columns: ['customer_id'],
        references: { dbSchema: 'public', table: 'customers', columns: ['id'] },
        onDelete: 'CASCADE',
      },
    ],
  },
};
```

### `order_items`

`src/schemas/orderItemsSchema.js`

```javascript
export const orderItemsSchema = {
  dbSchema: 'public',
  table: 'order_items',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'order_id', type: 'uuid', notNull: true },
    { name: 'sku', type: 'varchar(64)', notNull: true },
    { name: 'quantity', type: 'integer', notNull: true, default: '1' },
    { name: 'unit_price', type: 'numeric(12,2)', notNull: true },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['order_id', 'sku']],
    foreignKeys: [
      {
        columns: ['order_id'],
        references: { dbSchema: 'public', table: 'orders', columns: ['id'] },
        onDelete: 'CASCADE',
      },
    ],
  },
};
```

Each schema is paired with a model class under `src/models/` that extends
`TableModel`. The index file exports a `models` map used by the DB singleton:

```javascript
// src/models/index.js
import { Customers } from './Customers.js';
import { Orders } from './Orders.js';
import { OrderItems } from './OrderItems.js';

export { Customers, Orders, OrderItems };

export const models = {
  customers: Customers,
  orders: Orders,
  orderItems: OrderItems,
};
```

Finally, initialise the database connection once at startup:

```javascript
// src/db.js
import { DB } from 'pg-schemata';
import { models } from './models/index.js';

let initialized = false;

export function initDb() {
  if (initialized) return DB;
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  DB.init(DATABASE_URL, models);
  initialized = true;
  return DB;
}
```

---

## 3. Initial Migration: `0001_initial_catalog`

Create `migrations/0001_initial_catalog.mjs` to bootstrap the schema. It uses
the provided `bootstrap` helper to call `createTable()` on every model inside a
single transaction.

```javascript
// migrations/0001_initial_catalog.mjs
import { bootstrap } from 'pg-schemata';
import { models } from '../src/models/index.js';

export async function up({ schema }) {
  await bootstrap({ models, schema });
}
```

> **Note**: The `bootstrap` function automatically enables the `pgcrypto` extension by default, which is needed for UUID generation. You can customize this by passing an `extensions` array: `bootstrap({ models, schema, extensions: ['pgcrypto', 'uuid-ossp', 'postgis'] })` or disable extensions entirely with `extensions: []`.

The migration runner (`migrate.mjs`) initialises the DB and applies pending
migrations:

```javascript
// migrate.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './src/db.js';
import { MigrationManager } from 'pg-schemata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initDb();

const manager = new MigrationManager({
  schema: 'public',
  dir: path.join(__dirname, 'migrations'),
});

const { applied, files } = await manager.applyAll();
```

### Run the bootstrap migration

```bash
cd order-service
npm install
npm run migrate
```

You should see output similar to:

```
Applied 1 migration(s):
- 0001_initial_catalog.mjs
```

Inspect the database (`psql` → `\dt public.*`) to confirm the three tables
exist.

---

## 4. Maintenance Change: Adding Order Status Fields

A few sprints later you need to track an order’s lifecycle. The change touches
both code and schema:

1. **Update the schema definition** so future deployments know about the new
   columns.
2. **Ship a migration** that alters the live database without dropping data.

### 4.1 Update the schema definition

Replace the earlier `ordersSchema` with the expanded version (this is already
the version committed in the example folder):

```javascript
// src/schemas/ordersSchema.js (current)
export const ordersSchema = {
  dbSchema: 'public',
  table: 'orders',
  hasAuditFields: true,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', immutable: true, colProps: { cnd: true } },
    { name: 'customer_id', type: 'uuid', notNull: true },
    { name: 'order_number', type: 'varchar(20)', notNull: true },
    { name: 'order_total', type: 'numeric(12,2)', notNull: true, default: '0' },
    { name: 'placed_at', type: 'timestamptz', notNull: true, default: 'now()' },
    { name: 'status', type: 'varchar(20)', notNull: true, default: "'pending'" },
    { name: 'shipped_at', type: 'timestamptz' },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['order_number']],
    foreignKeys: [
      {
        columns: ['customer_id'],
        references: { dbSchema: 'public', table: 'customers', columns: ['id'] },
        onDelete: 'CASCADE',
      },
    ],
  },
};
```

### 4.2 Write the follow-up migration

`migrations/0002_add_order_status.mjs`

```javascript
export async function up({ db, schema }) {
  await db.none(
    `ALTER TABLE "${schema}"."orders"
       ADD COLUMN status varchar(20) NOT NULL DEFAULT 'pending',
       ADD COLUMN shipped_at timestamptz`
  );
}
```

The statement runs inside the transaction managed by `MigrationManager`, so a
failure rolls back both column additions.

### 4.3 Apply the new migration

```bash
npm run migrate
```

Output:

```
Applied 1 migration(s):
- 0002_add_order_status.mjs
```

Existing rows receive the default status of `pending`. You can verify with
`psql`:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'
ORDER BY ordinal_position;
```

---

## 5. Recap & Next Steps

- Keep schema definitions and migrations in lockstep—always update the schema
  file **before** writing the follow-up migration so new deployments stay in
  sync.
- Treat migrations as part of your regular delivery workflow: write the code
  change, create the migration, run `npm run migrate`, and commit both pieces
  together.
- Extend the tutorial by adding seed scripts or Vitest integration tests that
  assert the new columns exist before creating downstream features.

Happy migrating!
