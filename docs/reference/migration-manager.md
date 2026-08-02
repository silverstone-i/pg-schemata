# MigrationManager

Discovers, applies, and tracks migrations per `(schema_name, module_name, migration_id)`, with enforced SHA-256 integrity verification, topological FK ordering, and advisory locking. Forward-only — there is no rollback surface.

**Import:**

```js
import {
  MigrationManager,
  defineMigration,
  orderModels,
  resolveModuleOrder,
  topoSort,
} from 'pg-schemata';
```

## Constructor

```js
new MigrationManager({ schema?, modules?, dir?, moduleName?, logger? })
```

| Option       | Type                 | Default        | Description                                    |
| ------------ | -------------------- | -------------- | ---------------------------------------------- |
| `schema`     | `string`             | `'public'`     | PostgreSQL schema to target                    |
| `modules`    | `ModuleDescriptor[]` | —              | Registry mode: modules with ordered migrations |
| `dir`        | `string`             | `'migrations'` | Directory mode: directory to scan              |
| `moduleName` | `string`             | `'default'`    | Directory mode: module_name recorded for files |
| `logger`     | `Logger \| null`     | `null`         | Passed into contexts and model construction    |

Registry and directory mode are mutually exclusive — passing `modules` together with `dir` or `moduleName` throws. Duplicate module names or duplicate migration ids within a module also throw at construction.

## defineMigration(input)

```ts
defineMigration({ id, description?, up }): Migration
```

Validates the shape and returns a frozen `Migration` with `checksum = sha256(id + (description ?? '') + up.toString())`. Throws `TypeError` on an empty id, a non-function `up`, or a non-string description.

## Types

```ts
interface ModuleDescriptor {
  name: string;
  models?: Record<string, RepositoryCtor>;
  migrations: Migration[]; // array order is authoritative
}

interface Migration {
  readonly id: string;
  readonly description?: string;
  readonly up: (context: MigrationContext) => Promise<unknown>;
  readonly checksum: string;
}

interface MigrationContext {
  schema: string;
  module: string;
  db: DbConnection; // the surrounding transaction
  pgp: IMain;
  logger: Logger | null;
  models: Record<string, unknown>; // schema-bound via forSchema()
  ensureExtensions: (extensions: string[]) => Promise<void>;
}

interface PendingMigrationInfo {
  module: string;
  id: string; // registry id, or file name
  description: string | null;
  checksum: string;
  source: 'registry' | 'file';
  file?: string; // absolute path, directory mode only
}
```

## Methods

### applyAll({ dryRun? })

Applies all pending migrations in a single transaction.

**Returns:** `Promise<ApplyAllResult>` — `{ schema, dryRun, moduleOrder, pending, applied }`

The method:

1. Acquires a PostgreSQL advisory lock scoped to the schema name
2. Fails if a legacy 1.x `schema_migrations` table shape is detected (nothing is modified)
3. Ensures the `schema_migrations` table exists (skipped on dry run — a dry run writes nothing)
4. Resolves module order via the FK topological sort (registry mode)
5. Verifies stored hashes for every already-applied catalog entry — a mismatch aborts before anything executes
6. Runs each pending `up()` in order and inserts its tracking row
7. Rolls back the entire transaction if anything fails

### listPending(t?)

Returns pending migrations in execution order, for both modes. Defaults to the pool connection. Also runs legacy detection and hash verification.

**Returns:** `Promise<PendingMigrationInfo[]>`

### ensure(t)

Creates the `schema_migrations` table if it doesn't exist; throws on a legacy-shape table.

## Ordering utilities

- `topoSort(graph, kind)` — generic dependency-first DFS. Self-edges are skipped, edges leaving the graph are ignored, and cycles throw `Cyclic <kind> dependency detected: a -> b -> a`.
- `orderModels(models)` — orders schema-bound model instances parent-first by their `constraints.foreignKeys` references. Used by `bootstrap()`.
- `resolveModuleOrder(modules, schema, db, pgp, logger?)` — module execution order: if module A's model references a table owned by module B, B comes first. Caller order is preserved among independent modules.

## schema_migrations table

Applied migrations are tracked with:

| Column         | Type          | Description                                   |
| -------------- | ------------- | --------------------------------------------- |
| `schema_name`  | `text`        | PostgreSQL schema name                        |
| `module_name`  | `text`        | Owning module (`'default'` in directory mode) |
| `migration_id` | `text`        | Registry id, or migration file name           |
| `hash`         | `text`        | Content hash, verified on every later run     |
| `description`  | `text`        | Migration description (nullable)              |
| `applied_at`   | `timestamptz` | When the migration was applied                |

Composite primary key: `(schema_name, module_name, migration_id)`.

See [the migrations guide](../guide/migrations.md#upgrading-from-1x) for the 1.x upgrade path.
