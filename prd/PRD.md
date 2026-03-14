# pg-schemata — Product Requirements Document

**Current Version:** 1.3.0
**License:** MIT
**Author:** Ian Silverstone

This document is the **source of truth** for pg-schemata's design. New features, changes, and contributions should be evaluated against the principles, contracts, and constraints defined here.

---

## 1. Purpose

pg-schemata is a lightweight PostgreSQL-first ORM layer built on pg-promise. It provides schema-driven table configuration, automatic ColumnSet generation, full CRUD, flexible WHERE builders, cursor-based pagination, and multi-schema support — without heavy ORM overhead.

### Problem

Heavy ORMs (Sequelize, TypeORM, Prisma) abstract away PostgreSQL's native capabilities behind their own query languages, schema definition formats, and migration systems. Teams lose direct control over SQL, pay runtime overhead for features they don't use, and struggle with PostgreSQL-specific features like schema-per-tenant multi-tenancy.

### Target Users

- Node.js backend developers building PostgreSQL-backed applications
- Teams building multi-tenant SaaS with schema-per-tenant isolation
- Developers who want ORM convenience without ORM weight

---

## 2. Design Principles

These principles guide all design decisions. When trade-offs arise, resolve them in this order.

1. **PostgreSQL-first** — Embrace PostgreSQL features directly (schemas, advisory locks, JSONB, generated columns, NULLS NOT DISTINCT). Never abstract away capabilities behind a generic database interface.

2. **Schema object is the single source of truth** — One JavaScript object defines a table's structure. DDL, ColumnSets, Zod validators, and CRUD behavior are all derived from it. No separate migration files, decorators, or config files should be needed to understand a table.

3. **Stay close to SQL** — The library generates SQL, not a query DSL. Consumers should always be able to predict what SQL will run. When in doubt, expose the SQL rather than hiding it.

4. **Minimal overhead** — pg-schemata is a thin layer over pg-promise. It should add no measurable latency to queries beyond what pg-promise itself costs.

5. **Backward compatibility is required** — Public API changes must not break existing consumers. New features use additive patterns (new options, object format alongside boolean format, etc.).

6. **Explicit over implicit** — Soft delete, audit fields, and validation are opt-in. No behavior is forced on consumers who don't configure it.

---

## 3. Public API Contract

The following exports from `src/index.js` constitute the **stable public API**. Breaking changes to these require a major version bump.

### Classes

| Export | Source | Stability |
|--------|--------|-----------|
| `DB` | `DB.js` | Stable — `DB.init()`, `DB.db`, `DB.pgp` |
| `TableModel` | `TableModel.js` | Stable — all public methods |
| `QueryModel` | `QueryModel.js` | Stable — all public methods |
| `MigrationManager` | `migrate/MigrationManager.js` | Stable |
| `SchemaMigrations` | `models/SchemaMigrations.js` | Stable |
| `migrationSchema` | `models/SchemaMigrations.js` | Stable — schema definition for `schema_migrations` table |
| `DatabaseError` | `DatabaseError.js` | Stable (default export) |
| `SchemaDefinitionError` | `SchemaDefinitionError.js` | Stable (default export) |

### Functions

| Export | Source | Stability |
|--------|--------|-----------|
| `db()` | `DB.js` | Stable — returns initialized db instance |
| `pgp()` | `DB.js` | Stable — returns pg-promise root |
| `callDb()` | `utils/callDB.js` | Stable — schema-aware model binding |
| `bootstrap()` | `migrate/bootstrap.js` | Stable |
| `setAuditActorResolver(fn)` | `auditActorResolver.js` | Stable |
| `clearAuditActorResolver()` | `auditActorResolver.js` | Stable |
| `getAuditActor()` | `auditActorResolver.js` | Stable |

### Internal (not part of public API)

The following are implementation details and may change without a major version bump:

- `src/utils/schemaBuilder.js` — ColumnSet generation, DDL generation, LRU cache internals
- `src/utils/generateZodValidator.js` — Zod schema auto-generation
- `src/utils/pg-util.js` — Logging utilities
- `src/utils/validation.js` — ID/UUID validation helpers
- `src/utils/ddlGenerator.js` — DDL generation internals
- ColumnSet cache size, TTL, and key format
- Internal method names prefixed with `_` or not listed in this contract

---

## 4. Technical Requirements

| Requirement | Value |
|-------------|-------|
| Runtime | Node.js >= 16 |
| Database | PostgreSQL >= 12 |
| Module System | ESM only (`"type": "module"`) |
| Peer Dependency | pg-promise >= 11.x |

### Runtime Dependencies

| Package | Purpose | Rationale |
|---------|---------|-----------|
| pg-promise | Database driver | See ADR-0001 |
| zod | DTO validation | See ADR-0006 |
| lodash | cloneDeep, isPlainObject | Minimal usage; candidate for removal |
| @nap-sft/tablsx | Excel I/O | See ADR-0009 |
| lru-cache | ColumnSet caching | See ADR-0008 |

---

## 5. API Specification

This section defines every public method signature, parameter contract, return type, and SQL generation pattern. Together with §6 Behavioral Contracts, it provides sufficient detail to reimplement pg-schemata from scratch.

### 5.1 DB (Singleton Initialization)

#### `DB.init(connection, repositories, logger?, options?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `connection` | `object \| string` | Yes | pg-promise connection config or connection string |
| `repositories` | `Object<string, Function>` | Yes | Map of repository names to constructor classes |
| `logger` | `object \| null` | No | Logger instance passed to every repository |
| `options` | `object` | No | Additional config |
| `options.auditActorResolver` | `() => string \| null` | No | Callback for dynamic audit actor resolution |

**Returns:** `typeof DB` (the class itself, for chaining)

**Behavior:**
1. Guards against double-initialization — if `DB.db` already exists, returns immediately
2. Validates `connection` is not null/undefined; validates `repositories` is a non-array object
3. Initializes pg-promise with `{ capSQL: true }` and an `extend()` hook
4. The `extend()` hook iterates `repositories`, calling `new RepoClass(obj, DB.pgp, logger)` for each entry and assigning the result as `obj[repositoryName]`
5. Creates the database instance: `DB.db = DB.pgp(connection)`
6. If `options.auditActorResolver` is provided, calls `setAuditActorResolver(fn)`

**Invariants:**
- Only one initialization per process (singleton)
- Each repository constructor receives `(db, pgp, logger)` — the `db` argument is the pg-promise connection/task object, not `DB.db`
- The `extend()` hook fires on every new connection/task, so repositories are available within transactions

#### `db()`

**Returns:** `IDatabase` — the initialized pg-promise database instance (`DB.db`)

#### `pgp()`

**Returns:** `IMain` — the pg-promise root library instance (`DB.pgp`)

### 5.2 QueryModel (Read-Only Base)

#### Constructor: `new QueryModel(db, pgp, schema, logger?)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `db` | `IDatabase` | Yes | pg-promise database or task instance |
| `pgp` | `IMain` | Yes | pg-promise root library |
| `schema` | `TableSchema` | Yes | Schema definition object |
| `logger` | `object \| null` | No | Logger with `.error()`, `.info()`, `.debug()` methods |

**Behavior:**
1. Validates `schema` is an object with `table` and `columns` properties; validates `db` and `pgp` are truthy
2. Deep-clones the schema (via `lodash.cloneDeep`). If `hasAuditFields` is truthy, calls `addAuditFields(schema)` before cloning
3. Creates the ColumnSet via `createColumnSet(this.schema, this.pgp)`
4. Stores `db`, `pgp`, `logger`, `_schema`, and `cs` as instance properties

**Getters:**
- `schema` → `this._schema` (the processed schema object)
- `schemaName` → `pgp.as.name(this._schema.dbSchema)` (escaped identifier)
- `tableName` → `pgp.as.name(this._schema.table)` (escaped identifier)

---

#### `findAll({ limit?, offset? }?)`

```
findAll({ limit = 50, offset = 0 } = {}) → Promise<Object[]>
```

Delegates to `findWhere([{ id: { $ne: null } }], 'AND', { limit, offset, orderBy: 'id' })`.

---

#### `findById(id)`

```
findById(id: number | string) → Promise<Object | null>
```

Validates `id` via `isValidId()` (finite number or non-empty string). Throws `Error('Invalid ID format')` if invalid. Delegates to `findOneBy([{ id }])`.

---

#### `findByIdIncludingDeactivated(id)`

```
findByIdIncludingDeactivated(id: number | string) → Promise<Object | null>
```

Same as `findById` but passes `{ includeDeactivated: true }` to `findOneBy`.

---

#### `findWhere(conditions?, joinType?, options?)`

```
findWhere(
  conditions: Object[] = [],
  joinType: 'AND' | 'OR' = 'AND',
  {
    columnWhitelist?: string[],
    filters?: Object,
    orderBy?: string | string[],
    limit?: number,
    offset?: number,
    includeDeactivated?: boolean = false
  } = {}
) → Promise<Object[]>
```

**SQL pattern:**
```sql
SELECT {columnWhitelist || *} FROM "dbSchema"."table"
  WHERE ({conditions clause}) AND {filters clause}
  ORDER BY {orderBy}
  LIMIT {limit} OFFSET {offset}
```

**Behavior:**
1. Validates `conditions` is an array
2. If `conditions.length > 0`, builds WHERE via `buildWhereClause(conditions, true, [], joinType, includeDeactivated)`
3. If `filters` has keys, appends via `buildCondition([filters], 'AND', values)`
4. `columnWhitelist` columns are escaped via `pgp.as.name()`
5. `limit` and `offset` are `parseInt()`-ed
6. Executes via `db.any(query, values)`

---

#### `findOneBy(conditions, options?)`

```
findOneBy(conditions: Object[], options?: Object) → Promise<Object | null>
```

Calls `findWhere(conditions, 'AND', options)` and returns `results[0] || null`.

---

#### `findAfterCursor(cursor?, limit?, orderBy?, options?)`

```
findAfterCursor(
  cursor: Object = {},
  limit: number = 50,
  orderBy: string[] = ['id'],
  {
    descending?: boolean = false,
    columnWhitelist?: string[],
    filters?: Object,
    includeDeactivated?: boolean = false
  } = {}
) → Promise<{ rows: Object[], nextCursor: Object | null }>
```

**SQL pattern:**
```sql
SELECT {cols} FROM "dbSchema"."table"
  WHERE (col1, col2) > ($1, $2)        -- or < for descending
    AND {filters}
    AND deactivated_at IS NULL          -- if softDelete && !includeDeactivated
  ORDER BY col1, col2 ASC|DESC
  LIMIT $N
```

**Behavior:**
1. If `cursor` has keys, maps `orderBy` columns to cursor values (throws if any column missing from cursor)
2. Uses PostgreSQL tuple comparison: `(escapedCols) > (placeholders)` (or `<` when `descending: true`)
3. Filters support `{ and: [...] }` / `{ or: [...] }` top-level nesting
4. `nextCursor` is built from the last row's `orderBy` column values, or `null` if no rows returned

---

#### `findSoftDeleted(conditions?, joinType?, options?)`

```
findSoftDeleted(
  conditions: Object[] = [],
  joinType: 'AND' | 'OR' = 'AND',
  options?: Object
) → Promise<Object[]>
```

Rejects with `Error` if `softDelete` is not enabled. Otherwise delegates to `findWhere([...conditions, { deactivated_at: { $ne: null } }], joinType, { ...options, includeDeactivated: true })`.

---

#### `isSoftDeleted(id)`

```
isSoftDeleted(id: number | string) → Promise<boolean>
```

Rejects if `softDelete` not enabled. Validates `id`. Delegates to `exists({ id, deactivated_at: { $ne: null } }, { includeDeactivated: true })`.

---

#### `reload(id, options?)`

```
reload(id: number | string, { includeDeactivated?: boolean = false } = {}) → Promise<Object | null>
```

Delegates to `findById(id, { includeDeactivated })`.

---

#### `countWhere(conditions?, joinType?, options?)`

```
countWhere(
  conditions: Object[] = [],
  joinType: 'AND' | 'OR' = 'AND',
  { filters?: Object, includeDeactivated?: boolean = false } = {}
) → Promise<number>
```

**SQL pattern:** `SELECT COUNT(*) FROM "dbSchema"."table" WHERE {clause}`

Returns `parseInt(result.count, 10)`.

---

#### `countAll(options?)`

```
countAll({ includeDeactivated?: boolean = false } = {}) → Promise<number>
```

**SQL pattern:** `SELECT COUNT(*) FROM "dbSchema"."table"` with optional `WHERE deactivated_at IS NULL`.

---

#### `exists(conditions, options?)`

```
exists(conditions: Object, options?: { includeDeactivated?: boolean }) → Promise<boolean>
```

Validates `conditions` is a non-empty plain object. Uses `SELECT EXISTS (SELECT 1 FROM ... WHERE ...) AS "exists"` via `db.one()`. Returns `result.exists`.

---

#### `exportToSpreadsheet(filePath, where?, joinType?, options?)`

```
exportToSpreadsheet(
  filePath: string,
  where: Object[] = [],
  joinType: 'AND' | 'OR' = 'AND',
  options?: Object
) → Promise<{ exported: number, filePath: string }>
```

Queries via `findWhere`, then uses `@nap-sft/tablsx` (`WorkbookBuilder.create()`, `sheet.setHeaders()`, `sheet.addObjects()`, `writeXlsx()`) to write `.xlsx`. Uses `writeFileSync`.

---

#### `buildValuesClause(data)`

```
buildValuesClause(data: Object[] | Array[]) → string
```

Returns empty string if `data` is empty/not an array. Otherwise returns `pgp.helpers.values(data, this.cs)`.

---

#### `validateDto(data, validator, type?)`

```
validateDto(data: Object | Object[], validator: ZodSchema, type?: string = 'DTO') → void
```

Calls `validator.array().parse(data)` if array, otherwise `validator.parse(data)`. On failure, throws `SchemaDefinitionError` with `cause` set to `err.errors || err`.

---

#### `sanitizeDto(dto, options?)`

```
sanitizeDto(dto: Object, { includeImmutable?: boolean = true } = {}) → Object
```

Filters `dto` keys to only those matching schema column names. If `includeImmutable: false`, excludes columns with `immutable: true`.

---

#### `escapeName(name)`

```
escapeName(name: string) → string
```

Escapes an identifier (column name, table name) via `pgp.as.name(name)`. Used internally by all query-building methods and available to consumers for custom SQL construction.

---

#### `setSchemaName(name)`

```
setSchemaName(name: string) → QueryModel
```

Validates `name` is a non-empty string. Deep-clones `_schema`, sets `dbSchema = name`, regenerates ColumnSet via `createColumnSet()`. Returns `this`.

---

#### `buildWhereClause(where, requireNonEmpty?, values?, joinType?, includeDeactivated?)`

```
buildWhereClause(
  where: Object | Object[],
  requireNonEmpty: boolean = true,
  values: any[] = [],
  joinType: 'AND' | 'OR' = 'AND',
  includeDeactivated: boolean = false
) → { clause: string, values: any[] }
```

Accepts either an array or plain object of conditions. Delegates to `buildCondition()`. Appends `AND deactivated_at IS NULL` if `softDelete && !includeDeactivated`.

---

#### `buildCondition(group, joiner?, values?)`

```
buildCondition(group: Object[], joiner: 'AND' | 'OR' = 'AND', values: any[] = []) → string
```

Iterates each item in `group`. For each key-value pair:

| Value shape | SQL output |
|-------------|------------|
| `null` | `"col" IS NULL` |
| Scalar (string, number) | `"col" = $N` (parameterized) |
| `{ $like: v }` | `"col" LIKE $N` |
| `{ $ilike: v }` | `"col" ILIKE $N` |
| `{ $from: v }` | `"col" >= $N` |
| `{ $to: v }` | `"col" <= $N` |
| `{ $in: [...] }` | `"col" IN ($N, $N+1, ...)` — throws if empty array |
| `{ $eq: v }` | `"col" = $N` |
| `{ $ne: null }` | `"col" IS NOT NULL` |
| `{ $ne: v }` | `"col" != $N` |
| `{ $is: null }` | `"col" IS NULL` — throws if value is not `null` |
| `{ $not: null }` | `"col" IS NOT NULL` — throws if value is not `null` |
| `{ $max: true }` | `"col" = (SELECT MAX("col") FROM "schema"."table")` |
| `{ $min: true }` | `"col" = (SELECT MIN("col") FROM "schema"."table")` |
| `{ $sum: true }` | `"col" = (SELECT SUM("col") FROM "schema"."table")` |
| `{ $and: [...] }` or `{ and: [...] }` | `(recursive AND group)` |
| `{ $or: [...] }` or `{ or: [...] }` | `(recursive OR group)` |

Unsupported operator keys throw `SchemaDefinitionError`.

All column names are escaped via `pgp.as.name()`. All values are parameterized (positional `$N`).

---

#### `handleDbError(err)`

```
handleDbError(err: Error) → never
```

Logs via `logger.error` if available. Maps PostgreSQL SQLSTATE codes to `DatabaseError`:

| SQLSTATE | Message |
|----------|---------|
| `23505` | Unique constraint violation |
| `23503` | Foreign key constraint violation |
| `23514` | Check constraint violation |
| `22P02` | Invalid input syntax for type |
| (default) | Database operation failed |

Always throws `DatabaseError(message, err)`.

---

### 5.3 TableModel (Full CRUD)

Extends `QueryModel`. Adds write operations, Zod validation, audit field resolution, and soft delete management.

#### Constructor: `new TableModel(db, pgp, schema, logger?)`

**Behavior:**
1. Throws `SchemaDefinitionError('Primary key must be defined in the schema')` if `schema.constraints?.primaryKey` is falsy
2. Calls `super(db, pgp, schema, logger)`
3. Determines `_auditUserDefault`:
   - Object format (`{ enabled: true, userFields: { default: X } }`): uses `X` or `null`
   - Boolean format (`true`): uses `'system'`
   - Otherwise: `null`
4. Auto-generates Zod validators via `generateZodFromTableSchema(this._schema)` if `_schema.validators` not already set

---

#### `insert(dto)`

```
insert(dto: Object) → Promise<Object>
```

**Behavior:**
1. Rejects if `dto` is not a plain object
2. Validates via `insertValidator.parse(dto)` — rejects with `SchemaDefinitionError` on failure
3. Sanitizes via `sanitizeDto(dto)` (includes immutable columns)
4. If `hasAuditFields` and `created_by` not present: sets `created_by = _resolveAuditActor()`
5. Builds query: `pgp.helpers.insert(safeDto, this.cs.insert) + ' RETURNING *'`
6. Executes via `db.one(query)` — returns the full inserted row
7. On pg error: calls `handleDbError(err)`

---

#### `update(id, dto)`

```
update(id: number | string, dto: Object) → Promise<Object | null>
```

**Behavior:**
1. Rejects if `id` is invalid or `dto` is empty/not-object
2. Validates via `updateValidator.parse(dto)`
3. Sanitizes via `sanitizeDto(dto, { includeImmutable: false })` — immutable columns are stripped
4. If `hasAuditFields` and `updated_by` not present: sets `updated_by = _resolveAuditActor()`
5. Adds soft delete check: `AND deactivated_at IS NULL` if `softDelete`
6. Builds query: `pgp.helpers.update(safeDto, this.cs.update, { schema, table }) + ' WHERE id = $1' + softCheck + ' RETURNING *'`
7. Executes via `db.result()` with custom result handler
8. Returns the updated row if `rowCount > 0`, otherwise `null`

---

#### `delete(id)`

```
delete(id: number | string) → Promise<number>
```

**SQL pattern:** `DELETE FROM "schema"."table" WHERE id = $1 [AND deactivated_at IS NULL]`

Returns `rowCount`. Note: when `softDelete` is enabled, this only deletes active records (adds the soft delete check).

---

#### `upsert(dto, conflictColumns, updateColumns?)`

```
upsert(
  dto: Object,
  conflictColumns: string[],
  updateColumns?: string[] = null
) → Promise<Object>
```

**Behavior:**
1. Validates `dto` is plain object, `conflictColumns` is non-empty array
2. Sanitizes `dto`, sets `created_by` and `updated_by` via actor resolution if audit fields enabled
3. Builds a dynamic `ColumnSet` from `Object.keys(safeDto)`
4. Determines `updateColumns`: defaults to all non-conflict, non-id columns; always excludes audit field names from the explicit SET list
5. Appends audit update clause: `updated_at = NOW(), updated_by = EXCLUDED.updated_by`

**SQL pattern:**
```sql
INSERT INTO "schema"."table" (...) VALUES (...)
ON CONFLICT (conflictCol1, conflictCol2)
DO UPDATE SET col1 = EXCLUDED.col1, ..., updated_at = NOW(), updated_by = EXCLUDED.updated_by
RETURNING *
```

Executes via `db.one()`.

---

#### `bulkUpsert(records, conflictColumns, updateColumns?, returning?)`

```
bulkUpsert(
  records: Object[],
  conflictColumns: string[],
  updateColumns?: string[] = null,
  returning?: string[] = null
) → Promise<number | Object[]>
```

Same conflict resolution logic as `upsert`, but for multiple records. Executes within `db.tx()`. Returns `rowCount` if no `returning`, or array of rows if `returning` is specified.

---

#### `deleteWhere(where)`

```
deleteWhere(where: Object | Object[]) → Promise<number>
```

**SQL pattern:** `DELETE FROM "schema"."table" WHERE {clause} [AND deactivated_at IS NULL]`

Appends soft delete check if enabled. Returns `rowCount`.

---

#### `touch(id, updatedBy?)`

```
touch(id: number | string, updatedBy?: string = null) → Promise<Object | null>
```

Resolves `updatedBy` via `_resolveAuditActor()` if null. Delegates to `update(id, { updated_by: effectiveUpdatedBy })`. If no actor can be resolved (both `updatedBy` and the resolver return null/falsy), passes an empty object to `update()`, which will reject with `SchemaDefinitionError`.

---

#### `updateWhere(where, updates, options?)`

```
updateWhere(
  where: Object | Object[],
  updates: Object,
  { includeDeactivated?: boolean = false } = {}
) → Promise<number>
```

**Behavior:**
1. Validates `where` and `updates` are non-empty
2. Validates `updates` via `updateValidator`
3. Sanitizes `updates` with `{ includeImmutable: false }`
4. Sets `updated_by` via actor resolution if audit fields enabled
5. Builds a dynamic `ColumnSet` from `Object.keys(safeUpdates)` (not `this.cs.update`)
6. Executes: `pgp.helpers.update(safeUpdates, dynamicCs) + ' WHERE ' + clause`
7. Returns `rowCount`

---

#### `bulkInsert(records, returning?)`

```
bulkInsert(records: Object[], returning?: string[] = null) → Promise<number | Object[]>
```

**Behavior:**
1. Validates records array is non-empty, validates `returning` is array or null
2. Validates all records via `insertValidator` using `validateDto(records, validator)`
3. Sanitizes each record; sets `created_by` via actor resolution if audit
4. If `softDelete`: throws `SchemaDefinitionError` if any record contains `deactivated_at`
5. Builds dynamic `ColumnSet` from first record's keys
6. Builds query: `pgp.helpers.insert(safeRecords, cs)` + optional `RETURNING` clause
7. Executes within `db.tx()` (or `this.tx` if available)
8. Returns `rowCount` or array of rows

---

#### `bulkUpdate(records, returning?)`

```
bulkUpdate(records: Object[], returning?: string[] = null) → Promise<Array>
```

**Behavior:**
1. Validates schema has `primaryKey`, records array is non-empty
2. Validates all records via `updateValidator`
3. For each record: validates `id`, sanitizes with `{ includeImmutable: false }`, sets `updated_by`, removes `id` from update payload
4. Adds soft delete check per record: `AND deactivated_at IS NULL`
5. Builds per-record dynamic `ColumnSet` and `pgp.helpers.update()` query
6. Executes all queries via `tx.batch()` within a transaction
7. Returns array of results (one per record)

---

#### `importFromSpreadsheet(filePath, sheetIndex?, callbackFn?, returning?)`

```
importFromSpreadsheet(
  filePath: string,
  sheetIndex: number = 0,
  callbackFn?: (row: Object) => Object | null = null,
  returning?: string[] = null
) → Promise<{ inserted: number | Object[] }>
```

**Behavior:**
1. Reads file via `readFileSync`, parses via `@nap-sft/tablsx.WorkbookReader.fromBuffer()`
2. Validates sheet index is in bounds
3. First row is treated as headers; subsequent rows are mapped to objects
4. Each row is optionally transformed via `callbackFn` (supports async callbacks)
5. Strips `deactivated_at` from all rows if `softDelete` enabled
6. Delegates to `bulkInsert(rows, returning)`

---

#### `removeWhere(where)`

```
removeWhere(where: Object | Object[]) → Promise<number>
```

Rejects if `softDelete` not enabled (with `status: 403`). Sets `deactivated_at = NOW()`. If `hasAuditFields` and actor resolves: also sets `updated_by` and `updated_at = NOW()`. Only affects active records (`AND deactivated_at IS NULL`). Returns `rowCount`.

---

#### `restoreWhere(where)`

```
restoreWhere(where: Object | Object[]) → Promise<number>
```

Rejects if `softDelete` not enabled. Sets `deactivated_at = NULL`. If `hasAuditFields` and actor resolves: also sets `updated_by` and `updated_at = NOW()`. Builds WHERE with `includeDeactivated: true`. Returns `rowCount`.

---

#### `purgeSoftDeleteWhere(where?)`

```
purgeSoftDeleteWhere(where: Object | Object[] = []) → Promise<Object>
```

Rejects if `softDelete` not enabled. Hard-deletes only soft-deleted records by appending `{ deactivated_at: { $not: null } }` to conditions with `includeDeactivated: true`. Returns raw pg-promise result object.

---

#### `purgeSoftDeleteById(id)`

```
purgeSoftDeleteById(id: number | string) → Promise<Object>
```

Validates `id`. Delegates to `purgeSoftDeleteWhere([{ id }])`.

---

#### `truncate()`

```
truncate() → Promise<void>
```

**SQL:** `TRUNCATE TABLE "schema"."table" RESTART IDENTITY CASCADE`

Executes via `db.none()`.

---

#### `createTable()`

```
createTable() → Promise<void>
```

Calls `createTableSQL(this._schema, this.logger)` (from schemaBuilder) to generate DDL, then executes via `db.none()`. Includes index creation if `constraints.indexes` is defined.

---

### 5.4 Utility Functions

#### `callDb(modelOrName, schemaName)`

```
callDb(modelOrName: string | Object, schemaName: string) → Object
```

If `modelOrName` is a string, resolves from `DB.db[modelOrName]`. Validates the model has a `setSchemaName` method. Calls `model.setSchemaName(schemaName)` and returns the model.

#### `bootstrap({ models, schema?, extensions?, db? })`

```
bootstrap({
  models: Object<string, Function>,
  schema?: string = 'public',
  extensions?: string[] = ['pgcrypto'],
  db?: object = null
}) → Promise<void>
```

**Behavior:**
1. Validates `models` is an object
2. Enables each PostgreSQL extension: `CREATE EXTENSION IF NOT EXISTS $1:name`
3. For each model class: instantiates `new ModelClass(t, DB.pgp)`, calls `setSchemaName(schema)`, calls `createTable()`
4. Runs within provided `db` transaction or creates new one via `DB.db.tx()`

#### `setAuditActorResolver(fn)`

```
setAuditActorResolver(fn: () => string | null) → void
```

Validates `fn` is a function. Sets the module-level `_auditActorResolver`. Only one resolver active at a time.

#### `clearAuditActorResolver()`

```
clearAuditActorResolver() → void
```

Resets `_auditActorResolver` to `null`.

#### `getAuditActor()`

```
getAuditActor() → string | null
```

Returns `_auditActorResolver?.() ?? null`.

---

### 5.5 MigrationManager

#### Constructor: `new MigrationManager({ schema?, dir? }?)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `schema` | `string` | `'public'` | Target PostgreSQL schema |
| `dir` | `string` | `'migrations'` | Directory containing migration files |

#### `ensure(t)`

```
ensure(t: ITask) → Promise<void>
```

Creates the `schema_migrations` table via `SchemaMigrations.createTable()`.

#### `currentVersion(t)`

```
currentVersion(t: ITask) → Promise<number>
```

**SQL:** `SELECT COALESCE(MAX(version), 0) AS v FROM "schema"."schema_migrations" WHERE schema_name = $1`

Returns `0` if no migrations have been applied.

#### `listPending(t)`

```
listPending(t: ITask) → Promise<Array<{ file: string, version: number, full: string }>>
```

Reads directory, filters files matching `/^\d+_.*\.mjs$/`, parses numeric prefix as version, returns files with `version > currentVersion`, sorted ascending.

#### `applyAll()`

```
applyAll() → Promise<{ applied: number, files: string[] }>
```

**Behavior:**
1. Opens a transaction via `DB.db.tx()`
2. Acquires advisory lock: `SELECT pg_advisory_xact_lock(hashtext($1))` with `this.schema`
3. Calls `ensure(t)` to create tracking table
4. Calls `listPending(t)` to discover pending files
5. For each pending migration:
   a. Dynamic-imports the `.mjs` file (converts path to `file://` URL)
   b. Validates it exports `up` as a function
   c. Calls `module.up({ db: t, schema: this.schema })`
   d. Computes SHA-256 hash of the file contents
   e. Records in `schema_migrations`: `(schema_name, version, hash, label)`
6. Returns count and file names of applied migrations

**Invariants:**
- All migrations run in a single transaction — failure rolls back everything
- Advisory lock prevents concurrent migration runs on the same schema
- The `db` parameter passed to `up()` is the transaction object, not `DB.db`

#### `SchemaMigrations` (TableModel subclass)

```
new SchemaMigrations(db, pgp, logger?)
```

Extends `TableModel` with the built-in `migrationSchema`. The schema defines the `schema_migrations` table:

| Column | Type | Constraints |
|--------|------|-------------|
| `schema_name` | `text` | NOT NULL, part of composite PK |
| `version` | `integer` | NOT NULL, part of composite PK |
| `hash` | `text` | NOT NULL |
| `label` | `text` | nullable |
| `applied_at` | `timestamptz` | NOT NULL, DEFAULT `now()` |

**Constraints:** Composite primary key `(schema_name, version)`. Index on `(schema_name, version)`. Audit fields enabled (`hasAuditFields: true`).

The `migrationSchema` object is also exported for consumers who need to inspect or extend the migration table schema.

---

### 5.6 ColumnSet Construction (Internal)

While `schemaBuilder.js` is internal, its behavior defines the SQL contracts that public methods depend on.

#### `createColumnSet(schema, pgp, logger?)`

**Cache:** LRU cache keyed by `"${table}::${dbSchema}"`, max 20,000 entries, 1-hour TTL.

**Behavior:**
1. Returns cached result if available
2. Validates `colProps.skip` is a function if provided (throws `SchemaDefinitionError` otherwise)
3. Filters out audit field columns (`created_at`, `created_by`, `updated_at`, `updated_by`) from base columns
4. Validates audit field presence matches `hasAuditFields` config
5. For each column, builds a pg-promise column object:
   - Skips `serial` PKs entirely (auto-generated)
   - Skips `uuid` PKs that have a default (auto-generated)
   - Copies `colProps` (except `validator`) into the column object
   - Sets `def` from column `default` or `colProps.def`
6. Creates three `ColumnSet` variants:

| Variant | Content | Purpose |
|---------|---------|---------|
| `cs[tableName]` | Base columns (no audit fields) | General use |
| `cs.insert` | Base + `created_by` | INSERT operations |
| `cs.update` | Base + `updated_at` (with `mod: '^'`, `def: 'CURRENT_TIMESTAMP'`) + `updated_by` | UPDATE operations |

The `mod: '^'` on `updated_at` means the value is injected as raw SQL (not parameterized), so `CURRENT_TIMESTAMP` is used literally.

When `hasAuditFields` is false, `cs.insert` and `cs.update` both equal `cs[tableName]`.

---

### 5.7 DDL Generation (Internal)

#### `createTableSQL(schema, logger?)`

Generates the full DDL statement for creating a table and its indexes.

**SQL pattern:**
```sql
CREATE SCHEMA IF NOT EXISTS "dbSchema";
CREATE TABLE IF NOT EXISTS "dbSchema"."table" (
  "col1" type [NOT NULL] [DEFAULT value],
  ...
  PRIMARY KEY ("pk1", "pk2"),
  CONSTRAINT "uidx_table_cols_hash" UNIQUE [NULLS NOT DISTINCT] ("col1", "col2"),
  CONSTRAINT "fk_table_hash" FOREIGN KEY ("col") REFERENCES "refSchema"."refTable" ("refCol") [ON DELETE action] [ON UPDATE action],
  CHECK (expression)
);
CREATE INDEX IF NOT EXISTS "idx_table_col" ON "dbSchema"."table" ("col");
```

**Constraint naming conventions:**
- Unique constraints: `uidx_{table}_{columns joined by _}_{6-char MD5 hash}`
- Foreign keys: `fk_{table}_{6-char MD5 hash}` (hash of `table + refTable + columns`)
- Hash function: `crypto.createHash('md5').update(input).digest('hex').slice(0, 6)`

**Default value quoting rules:**
- SQL functions (containing `(...)`) → unquoted: `DEFAULT gen_random_uuid()`
- Numeric values → unquoted: `DEFAULT 0`
- Quoted strings with type casts (`'...'::type`) → preserved as-is
- Already single-quoted → preserved as-is
- Everything else → auto-quoted: `DEFAULT 'value'`

**Generated columns:** `"name" type GENERATED {ALWAYS|BY DEFAULT} AS (expression) [STORED]`

**Foreign key cross-schema references:** If `references.table` contains a dot (e.g., `"other_schema.users"`), it splits into schema and table parts.

#### `createIndexesSQL(schema, unique?, logger?)`

**Index SQL pattern:**
```sql
CREATE [UNIQUE] INDEX [IF NOT EXISTS] "indexName"
  ON "dbSchema"."table" [USING METHOD]
  ("col1" [opclass] [ASC|DESC], ...)
  [WHERE condition]
  [WITH (param = value)]
  [TABLESPACE name];
```

**Index naming:** `{prefix}_{table}_{columns joined by _}` (lowercase), where prefix is `uidx` for unique, `idx` for regular. Custom names via `index.name` property.

**Column expressions support:**
- Simple string: `"colName"`
- Object: `{ column: 'name', opclass: 'text_ops', order: 'DESC' }`

#### `addAuditFields(schema)`

Mutates the schema's `columns` array by pushing audit fields if not already present:

| `hasAuditFields` format | `created_by` / `updated_by` type | Default value |
|------------------------|----------------------------------|---------------|
| `true` (boolean) | `varchar(50)` | `'system'` (single-quoted for DDL) |
| `{ enabled: true }` (no userFields) | `varchar(50)` | `null` (nullable, no default) |
| `{ enabled: true, userFields: { type, nullable, default } }` | Custom type | Custom default |

Also adds `deactivated_at timestamptz` (nullable, no default) if `softDelete: true`.

`created_at` and `created_by` are marked `immutable: true`.

---

### 5.8 Zod Validator Generation (Internal)

#### `generateZodFromTableSchema(schema)`

Returns `{ baseValidator: ZodObject, insertValidator: ZodObject, updateValidator: ZodObject }`.

**Type mapping:**

| SQL Type | Zod Type |
|----------|----------|
| `varchar(N)` | `z.string().max(N)` |
| `text` | `z.string()` |
| `uuid` | `z.string().uuid()` |
| `int`, `serial` | `z.number().int()` |
| `numeric` | `z.number()` |
| `boolean` | `z.boolean()` |
| `timestamp`, `date` | `z.coerce.date()` |
| `jsonb` | `z.any()` |
| (all others, including `timestamptz`) | `z.any()` |

**Validator variants:**
- **baseValidator:** `notNull` → required; otherwise `zodType.nullable().optional()`
- **insertValidator:** `notNull` AND no `default` → required; otherwise `nullable().optional()`
- **updateValidator:** all fields `nullable().optional()`

**Special behaviors:**
- Column named `email` with string type: adds `.email()` validation
- `colProps.validator` overrides the auto-generated Zod type for that column
- CHECK constraints with `char_length(field) > N`: adds `.min(N+1)` to the Zod type
- CHECK constraints with `field IN ('A', 'B')`: replaces Zod type with `z.enum(['A', 'B'])`

---

### 5.9 Error Classes

#### `DatabaseError`

```
new DatabaseError(message: string, originalError: Error)
```

**Properties:**
- `name`: `'DatabaseError'`
- `message`: The provided message string
- `code`: `originalError.code` (SQLSTATE)
- `detail`: `originalError.detail`
- `constraint`: `originalError.constraint`
- `table`: `originalError.table`
- `original`: The full original error object

#### `SchemaDefinitionError`

```
new SchemaDefinitionError(message: string, originalError?: Error = null)
```

**Properties:**
- `name`: `'SchemaDefinitionError'`
- `message`: The provided message string
- `original`: The `originalError` passed to the constructor (or `null`)
- `cause`: Set after construction by calling code (e.g., `error.cause = zodError.errors`) — used by validation to attach ZodError details

---

### 5.10 ID Validation (Internal)

`isValidId(id)` returns `true` if:
- `id` is a finite number (`typeof id === 'number' && Number.isFinite(id)`), OR
- `id` is a non-empty string after trimming

Used by `findById`, `delete`, `update`, `isSoftDeleted`, `purgeSoftDeleteById`, and all `bulkUpdate` record validations.

---

## 6. Behavioral Contracts

These define how the system **must** behave. They are the acceptance criteria for existing features and the spec that tests validate against.

### 6.1 Schema Definition

A table schema is a plain JavaScript object. The canonical structure is defined in `src/schemaTypes.d.ts` (`TableSchema` interface).

**Required properties:** `dbSchema` (string), `table` (string), `columns` (ColumnDefinition[])

**Optional properties:** `constraints` (Constraints), `hasAuditFields` (boolean | AuditFieldsConfig), `softDelete` (boolean), `version` (string)

**Column definition properties:** `name` (required), `type` (required), `notNull`, `default`, `immutable`, `generated`, `expression`, `stored`, `colProps` ({ mod, skip, cnd, init, def, validator })

**Constraints:** `primaryKey` (string[]), `unique` (string[] | UniqueConstraintDefinition)[], `foreignKeys` (ConstraintDefinition[]), `checks` (ConstraintDefinition[]), `indexes` (ConstraintDefinition[])

**Invariants:**
- TableModel requires `constraints.primaryKey` to be defined; constructor throws `SchemaDefinitionError` if missing
- `notNull: true` is the canonical way to express NOT NULL (not the deprecated `nullable: false`)
- String defaults must be single-quoted within the string: `default: "'user'"`
- Function defaults must not include schema prefix: `default: 'gen_random_uuid()'`
- The property is `dbSchema`, never `schema`
- Naming convention: snake_case for all table names, column names, and schema names

### 6.2 Soft Delete

**Activation:** `softDelete: true` adds a `deactivated_at TIMESTAMPTZ DEFAULT NULL` column.

**Active record:** `deactivated_at IS NULL`. **Soft-deleted record:** `deactivated_at` contains a timestamp.

**Automatic filtering:** These methods append `AND deactivated_at IS NULL` to WHERE clauses: `findById`, `findAll`, `findWhere`, `findOneBy`, `findAfterCursor`, `countWhere`, `countAll`, `exists`. Bypass with `{ includeDeactivated: true }`.

**Operations:**
| Method | Behavior | Affects |
|--------|----------|---------|
| `removeWhere(conditions)` | Sets `deactivated_at = NOW()` | Active records matching conditions |
| `restoreWhere(conditions)` | Sets `deactivated_at = NULL` | Soft-deleted records matching conditions |
| `purgeSoftDeleteWhere(conditions)` | Hard DELETE | Soft-deleted records matching conditions |
| `purgeSoftDeleteById(id)` | Hard DELETE | One soft-deleted record by ID |
| `findSoftDeleted()` | SELECT | Records where `deactivated_at IS NOT NULL` |
| `delete(id)` | Hard DELETE | Active records only (adds `AND deactivated_at IS NULL` when softDelete enabled) |
| `deleteWhere(conditions)` | Hard DELETE | Active records matching conditions (adds `AND deactivated_at IS NULL` when softDelete enabled) |

**Invariants:**
- `bulkInsert()` strips `deactivated_at` from input — new records are always active
- `removeWhere` and `restoreWhere` set `updated_at` and `updated_by` when audit fields are enabled
- The column name is always `deactivated_at` (not configurable)
- `count()` on a table with 5 soft-deleted and 0 active records returns 0; `count({ includeDeactivated: true })` returns 5

### 6.3 Audit Fields

**Activation:** `hasAuditFields: true` (boolean) or `hasAuditFields: { enabled: true, userFields: { type, nullable, default } }` (object).

**Columns added:**
| Column | Type | Boolean format default | Object format default |
|--------|------|----------------------|----------------------|
| `created_at` | `timestamptz NOT NULL DEFAULT NOW()` | Same | Same (not configurable) |
| `created_by` | `varchar(50) NOT NULL DEFAULT 'system'` | Same | Configurable via `userFields` |
| `updated_at` | `timestamptz NOT NULL DEFAULT NOW()` | Same | Same (not configurable) |
| `updated_by` | `varchar(50) NOT NULL DEFAULT 'system'` | Same | Configurable via `userFields` |

**Actor resolution priority:** (1) audit actor resolver callback, (2) schema `_auditUserDefault`, (3) `'system'` (boolean format), (4) `null` (object format with `default: null`)

**When fields are set:**
- `created_at` / `created_by`: insert only (immutable after creation)
- `updated_at` / `updated_by`: insert, update, updateWhere, touch, upsert (conflict), bulkUpsert (conflict), removeWhere, restoreWhere

**Invariants:**
- `created_at`, `created_by`, `updated_at`, `updated_by` are reserved names when audit fields are enabled
- The resolver must be synchronous — async functions are not supported
- Only one resolver can be active (module-level singleton)
- `clearAuditActorResolver()` resets to null (for test cleanup)

### 6.4 WHERE Modifiers

Conditions are passed as an **array of objects**. Each object is a set of AND conditions.

**Operators:**
| Operator | SQL | Null behavior |
|----------|-----|---------------|
| Direct value | `=` / `IS NULL` | `{ col: null }` → `col IS NULL` |
| `$eq` | `=` | — |
| `$ne` | `!=` / `IS NOT NULL` | `$ne: null` → `IS NOT NULL` |
| `$like` | `LIKE` | — |
| `$ilike` | `ILIKE` | — |
| `$from` | `>=` | — |
| `$to` | `<=` | — |
| `$in` | `IN (...)` | Array must be non-empty |
| `$is` | `IS NULL` | Only accepts `null` |
| `$not` | `IS NOT NULL` | Only accepts `null` |
| `$max` | `= (SELECT MAX(...))` | Subquery against same table |
| `$min` | `= (SELECT MIN(...))` | Subquery against same table |
| `$sum` | `= (SELECT SUM(...))` | Subquery against same table |

**Boolean logic:** `$and` / `$or` (or `and` / `or` without prefix) nest condition groups.

**Invariants:**
- All values are parameterized via pg-promise — no SQL injection is possible
- Unsupported operators throw `SchemaDefinitionError`
- Soft delete filter is appended automatically when `softDelete: true` unless `includeDeactivated: true`

### 6.5 Zod Validation

Three validators are auto-generated per schema from `generateZodFromTableSchema()`:
- **baseValidator** — All fields, notNull enforced
- **insertValidator** — Only required fields (notNull without default)
- **updateValidator** — All fields optional

**Type mapping:** varchar/text/char → `z.string()`, uuid → `z.string().uuid()`, int/serial → `z.number().int()`, numeric → `z.number()`, boolean → `z.boolean()`, date/timestamp → `z.coerce.date()`, jsonb → `z.any()`. Note: `timestamptz` falls through to `z.any()` (the regex only matches exact `timestamp` and `date`).

**Invariants:**
- Validation runs automatically on `insert`, `update`, `bulkInsert`, `bulkUpdate`
- Validation failures throw `SchemaDefinitionError` with the ZodError as `original`
- Custom validators via `colProps.validator` override the auto-generated validator for that column
- Check constraints with `char_length` and `IN` clauses are integrated as `.min()` and `.enum()` Zod constraints

### 6.6 Error Handling

**DatabaseError** — Wraps pg/pg-promise errors. Properties: `code` (SQLSTATE), `detail`, `constraint`, `table`, `original`.

**SchemaDefinitionError** — Schema validation and DTO failures. Properties: `original` (optional, e.g., ZodError).

**SQLSTATE mapping:** 23505 (unique violation), 23503 (FK violation), 23514 (check violation), 22P02 (invalid input syntax)

**Invariants:**
- PostgreSQL errors are always wrapped in `DatabaseError` via `handleDbError()`
- Validation/config errors always use `SchemaDefinitionError`
- The `original` error is always preserved for tracing
- `logMessage()` provides structured logging with `{ logger, level, schema, table, message, data }`. Default level is `debug`. Debug-level messages are suppressed when `NODE_ENV === 'production'`. No-ops silently if `logger` is falsy or `logger[level]` is not a function.

### 6.7 Migration Management

**MigrationManager** discovers and executes `.mjs` migration files in order.

**File naming:** `NNNN_description.mjs` (numeric prefix determines order)

**Required export:** `async up({ db, schema })`

**Invariants:**
- All pending migrations run in a single transaction — any failure rolls back the entire batch
- SHA-256 hash of each file is stored in `schema_migrations` at application time
- `pg_advisory_xact_lock(hashtext(schema))` prevents concurrent migrations on the same schema
- The `schema_migrations` table is auto-created by `ensure()`

### 6.8 Cursor-Based Pagination

`findAfterCursor()` implements keyset pagination.

**Invariants:**
- Uses tuple comparison: `WHERE (col1, col2) > ($1, $2) ORDER BY col1, col2 LIMIT $3`
- Consistent O(N) performance regardless of page depth
- Soft delete filter applied before cursor comparison
- Cannot jump to arbitrary pages (no "go to page 50")

### 6.9 Multi-Schema Support

**Invariants:**
- `dbSchema` property on schema objects determines the PostgreSQL schema
- `setSchemaName()` switches schema at runtime
- Single pg-promise connection pool shared across all schemas/tenants
- ColumnSets are cached per `${table}::${dbSchema}` key

### 6.10 Excel Import/Export

- `importFromSpreadsheet(filePath, sheetIndex?, callbackFn?, returning?)` — Reads `.xlsx`, transforms rows via optional callback, validates, bulk inserts
- `exportToSpreadsheet(filePath, where?, joinType?, options?)` — Queries and writes to `.xlsx`

**Invariants:**
- Import strips `deactivated_at` when `softDelete: true`
- Import validates via Zod before inserting
- Export respects soft delete filter

---

## 7. Constraints and Trade-offs

Decisions the project has explicitly accepted. These are not bugs — they are intentional boundaries.

| Constraint | Rationale |
|-----------|-----------|
| PostgreSQL only — no MySQL, SQLite, etc. | Principle #1: PostgreSQL-first. Multi-database support would water down every feature. |
| Single database connection per process | pg-promise best practice. Multi-db would require architectural changes to DB singleton. |
| ESM only — no CommonJS | Aligns with Node.js ecosystem direction. CJS consumers must use dynamic `import()`. |
| Synchronous audit actor resolver | Keeps the insert/update hot path simple. Async resolution would complicate every write method. |
| One resolver at a time (global) | Module-level singleton. Per-model resolvers would add complexity for a rare use case. |
| `deactivated_at` column name is fixed | Standardization across all pg-schemata consumers. Custom column names would multiply code paths. |
| No eager/lazy relationship loading | Principle #3: stay close to SQL. Relationship loading is an ORM pattern that hides queries. |
| No connection pooling management | Deferred to pg-promise, which handles this well. Duplicating it adds no value. |

---

## 8. Roadmap

Planned enhancements, ordered by priority. Items move to the behavioral contracts section (§6) once implemented.

### Priority 1 — Near Term

| Enhancement | Description | Value |
|-------------|-------------|-------|
| Auto-index on `deactivated_at` | Generate index when `softDelete: true` | Query performance for soft-delete-heavy tables |
| Default audit field indexes | Auto-index `created_at`, `updated_at` | Common query pattern optimization |
| `markInactive(id)` | Shortcut: `removeWhere({ id })` | Developer convenience |
| `isActive(id)` | Boolean check: `deactivated_at IS NULL` for given ID | Developer convenience |

### Priority 2 — Medium Term

| Enhancement | Description | Value |
|-------------|-------------|-------|
| `softDeletedSince(daysAgo)` | Records where `deactivated_at` older than N days | Data lifecycle management |
| Partial unique constraints | `UNIQUE ... WHERE deactivated_at IS NULL` | Correct uniqueness with soft delete |
| Per-column DDL comments | `COMMENT ON COLUMN ...` from schema definition | Self-documenting database |
| `autoPurge(thresholdDays)` | Scheduled permanent deletion of old soft-deleted records | Data lifecycle management |

### Priority 3 — Long Term

| Enhancement | Description | Value |
|-------------|-------------|-------|
| DTO versioning/migrations | Multiple Zod DTO versions per schema version | API evolution support |
| Automatic migration script generation | DDL diffing between schema versions | CI/CD workflow support |
| Role-based permissions at model level | `readRoles`, `writeRoles` in schema metadata | Declarative access control |
| Embedded relationships | Declarative joins/lookups in schema | Scaffolding and code generation |
| Column type plugins | Extensible field types (IP, geometric, etc.) | PostgreSQL type ecosystem |

### Out of Scope (will not be built)

- Frontend/client-side code generation
- GraphQL or REST API generation
- Database-level row-level security (RLS)
- ORM-style relationship eager/lazy loading
- Multi-database (non-PostgreSQL) support

---

## 9. Version History

| Version | Date | Type | Highlights |
|---------|------|------|------------|
| v0.1.0-beta.1 | 2025-04-17 | Beta | Schema definitions, ColumnSet generation, base CRUD |
| v0.2.0-beta.1 | 2025-06-22 | Beta | Zod validation, spreadsheet I/O, cursor pagination, WHERE builders, error classes |
| v1.0.0 | 2025-08-16 | Major | First stable release: upsert/bulkUpsert, soft delete, TypeScript types |
| v1.1.0 | 2025-09-23 | Minor | Migration management, bootstrap utility |
| v1.2.0 | 2026-01-28 | Minor | Configurable audit fields (object format) |
| v1.2.1 | 2026-01-29 | Patch | NULLS NOT DISTINCT unique constraints |
| v1.2.2 | 2026-02-02 | Patch | Excel library migration (exceljs → xlsxjs) |
| v1.2.3 | 2026-02-02 | Patch | Fix xlsxjs import path |
| v1.3.0 | 2026-02-13 | Minor | Audit actor resolver, upsert/soft-delete audit fixes |

Full details in `CHANGELOG.md`.

---

## 10. Architecture Decision Records

See `prd/adr/` for historical decision context — why alternatives were considered and what trade-offs were accepted:

- ADR-0001: pg-promise as database driver
- ADR-0002: Schema-first approach
- ADR-0003: QueryModel/TableModel class hierarchy
- ADR-0004: Singleton DB pattern
- ADR-0005: ESM-only modules
- ADR-0006: Zod for runtime validation
- ADR-0007: Soft delete via deactivated_at
- ADR-0008: LRU caching for ColumnSets
- ADR-0009: Excel library migration
- ADR-0010: Audit actor resolver
- ADR-0011: Schema-per-tenant multi-tenancy
- ADR-0012: Cursor-based pagination
- ADR-0013: SHA-256 migration integrity

---

## 11. Operational Playbooks

See `prd/rules/` for day-to-day development procedures:

- `testing-patterns.md` — Test framework, directory structure, mocking patterns
- `release-versioning-process.md` — Branch flow, version bumps, npm publishing
