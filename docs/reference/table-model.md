# TableModel

Full CRUD model that extends [QueryModel](/reference/query-model). Adds write operations, validation, audit field population, and soft delete management.

**Import:**

```js
import { TableModel } from 'pg-schemata';
```

## Constructor

```js
new TableModel(db, pgp, schema, logger?)
```

Same parameters as QueryModel, but requires `schema.constraints.primaryKey` to be defined.

**Throws:** `SchemaDefinitionError` if no primary key is defined

## Inherited Methods

TableModel inherits all methods from [QueryModel](/reference/query-model): `findAll`, `findById`, `findWhere`, `findOneBy`, `findAfterCursor`, `count`, `countAll`, `exists`, `findSoftDeleted`, `isSoftDeleted`, `exportToSpreadsheet`, and all utility methods.

## Write Methods

### insert(dto)

Inserts a single row after validation and sanitization.

| Parameter | Type | Description |
|---|---|---|
| `dto` | `object` | Data to insert |

**Returns:** `Promise<Object>` — the inserted row (`RETURNING *`)
**Throws:** `SchemaDefinitionError` if validation fails or DTO is empty

### update(id, dto)

Updates a record by primary key.

| Parameter | Type | Description |
|---|---|---|
| `id` | `string \| number` | Primary key value |
| `dto` | `object` | Updated values |

**Returns:** `Promise<Object | null>` — updated row, or `null` if not found
**Throws:** `SchemaDefinitionError` if validation fails

### delete(id)

Hard deletes a row by primary key.

| Parameter | Type | Description |
|---|---|---|
| `id` | `string \| number` | Primary key value |

**Returns:** `Promise<number>` — number of rows deleted

### upsert(dto, conflictColumns, updateColumns?)

Inserts or updates on conflict.

| Parameter | Type | Description |
|---|---|---|
| `dto` | `object` | Data to insert or update |
| `conflictColumns` | `string[]` | Columns that define the conflict |
| `updateColumns` | `string[]` | Columns to update on conflict (optional — defaults to all non-conflict columns) |

**Returns:** `Promise<Object>` — the inserted or updated row

### deleteWhere(where)

Hard deletes rows matching a WHERE clause.

| Parameter | Type | Description |
|---|---|---|
| `where` | `object \| Object[]` | Filter criteria |

**Returns:** `Promise<number>` — number of rows deleted

### updateWhere(where, updates, options?)

Updates rows matching a WHERE clause.

| Parameter | Type | Description |
|---|---|---|
| `where` | `object \| Object[]` | Conditions |
| `updates` | `object` | Fields to update |
| `options.includeDeactivated` | `boolean` | Include soft-deleted rows (default `false`) |

**Returns:** `Promise<number>` — number of rows updated

### touch(id, updatedBy?)

Updates only the `updated_at` timestamp and optionally `updated_by`.

| Parameter | Type | Description |
|---|---|---|
| `id` | `string \| number` | Primary key value |
| `updatedBy` | `string` | Actor identifier (optional — uses resolver if omitted) |

**Returns:** `Promise<Object | null>`

## Bulk Methods

### bulkInsert(records, returning?)

Inserts multiple rows in a transaction.

| Parameter | Type | Description |
|---|---|---|
| `records` | `Object[]` | Rows to insert |
| `returning` | `string[] \| null` | Columns to return (optional) |

**Returns:** `Promise<number | Object[]>` — row count, or array of rows if `returning` specified

### bulkUpdate(records, returning?)

Updates multiple rows by primary key in a transaction.

| Parameter | Type | Description |
|---|---|---|
| `records` | `Object[]` | Each must include an `id` field |
| `returning` | `string[] \| null` | Columns to return (optional) |

**Returns:** `Promise<Array>` — array of row counts or row arrays

### bulkUpsert(records, conflictColumns, updateColumns?, returning?)

Bulk insert-or-update in a transaction.

| Parameter | Type | Description |
|---|---|---|
| `records` | `Object[]` | Rows to upsert |
| `conflictColumns` | `string[]` | Conflict columns |
| `updateColumns` | `string[]` | Columns to update (optional) |
| `returning` | `string[] \| null` | Columns to return (optional) |

**Returns:** `Promise<number | Object[]>`

## Soft Delete Methods

### removeWhere(where)

Soft deletes records by setting `deactivated_at = NOW()`.

**Returns:** `Promise<number>` — number of rows updated
**Throws:** `Error` if soft delete is not enabled

### restoreWhere(where)

Restores soft-deleted records by setting `deactivated_at = NULL`.

**Returns:** `Promise<number>`

### purgeSoftDeleteWhere(where?)

Permanently deletes soft-deleted rows matching conditions.

**Returns:** `Promise<Object>` — pg-promise result

### purgeSoftDeleteById(id)

Permanently deletes a specific soft-deleted row.

**Returns:** `Promise<Object>`

## Import/Export

### importFromSpreadsheet(filePath, sheetIndex?, callbackFn?, returning?)

Imports data from an Excel file into the table.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `filePath` | `string` | — | Source `.xlsx` file path |
| `sheetIndex` | `number` | `0` | Sheet index (0-based) |
| `callbackFn` | `(row) => Object` | `null` | Transform function per row |
| `returning` | `string[]` | `null` | Columns to return |

**Returns:** `Promise<{ inserted: number | Object[] }>`

## Schema Management

### createTable()

Creates the table from the schema definition, including indexes.

**Returns:** `Promise<void>`

### truncate()

Truncates the table and resets identity sequences.

**Returns:** `Promise<void>`
