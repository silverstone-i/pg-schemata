# MigrationManager

Discovers, applies, and tracks versioned migration scripts with SHA-256 integrity verification and advisory locking.

**Import:**

```js
import { MigrationManager } from 'pg-schemata';
```

## Constructor

```js
new MigrationManager({ schema?, dir? })
```

| Option | Type | Default | Description |
|---|---|---|---|
| `schema` | `string` | `'public'` | PostgreSQL schema to target |
| `dir` | `string` | `'migrations'` | Directory containing migration files |

## Methods

### applyAll()

Applies all pending migrations in a single transaction.

**Returns:** `Promise<{ applied: number, files: string[] }>`

The method:
1. Acquires a PostgreSQL advisory lock scoped to the schema name
2. Creates the `schema_migrations` table if it doesn't exist
3. Discovers migration files with version > current version
4. Runs each `up()` function in version order
5. Records each migration with its SHA-256 file hash
6. Rolls back the entire transaction if any migration fails

### listPending(t)

Returns pending migration files (version > current applied version).

| Parameter | Type | Description |
|---|---|---|
| `t` | `ITask` | pg-promise transaction or connection |

**Returns:** `Promise<Array<{ file: string, version: number, full: string }>>`

### currentVersion(t)

Returns the highest applied migration version.

| Parameter | Type | Description |
|---|---|---|
| `t` | `ITask` | pg-promise transaction or connection |

**Returns:** `Promise<number>` — current version, or `0` if no migrations applied

### ensure(t)

Creates the `schema_migrations` table if it doesn't exist.

| Parameter | Type | Description |
|---|---|---|
| `t` | `ITask` | pg-promise transaction or connection |

## Migration file format

Files must match the pattern `{number}_{label}.mjs`:

```
migrations/
  0001_create_users.mjs
  0002_add_indexes.mjs
  0003_add_roles_table.mjs
```

Each file exports an async `up` function:

```js
export async function up({ db, schema }) {
  await db.none(`
    CREATE TABLE IF NOT EXISTS "${schema}"."roles" (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE
    )
  `);
}
```

| Parameter | Type | Description |
|---|---|---|
| `db` | `ITask` | pg-promise transaction — all queries run inside the transaction |
| `schema` | `string` | Target PostgreSQL schema name |

## schema_migrations table

Applied migrations are tracked with:

| Column | Type | Description |
|---|---|---|
| `schema_name` | `varchar` | PostgreSQL schema name |
| `version` | `integer` | Migration version number |
| `hash` | `varchar(64)` | SHA-256 hash of the migration file |
| `label` | `varchar` | Migration file name |
| `applied_at` | `timestamptz` | When the migration was applied |

Composite primary key: `(schema_name, version)`.
