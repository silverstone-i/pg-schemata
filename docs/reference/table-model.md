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

`constraints.primaryKey` must be an array of column names. It generates the
`PRIMARY KEY` constraint and determines which columns the by-id methods target —
`findById`, `update`, `delete`, `bulkUpdate`, `reload`, and the soft-delete
helpers.

Those methods accept a **scalar** for single-column keys, resolved against the
declared column whatever it is named, or an **object** carrying every column for
composite keys:

```js
await coupons.findById('SAVE10'); // primaryKey: ['code']
await memberships.findById({ tenant_id, user_id }); // composite
```

Passing a scalar to a composite-key model throws `SchemaDefinitionError`.

::: warning Changed in 3.0.0
These methods previously emitted `WHERE id = $1` against a column literally
named `id`, whatever `primaryKey` declared. See
[primary keys](/guide/schema-definition#primary-keys-drive-row-targeting).
:::

## Inherited Methods

TableModel inherits all methods from [QueryModel](/reference/query-model): `findAll`, `findById`, `findWhere`, `findOneBy`, `findAfterCursor`, `countWhere`, `countAll`, `exists`, `findSoftDeleted`, `isSoftDeleted`, `exportToSpreadsheet`, and all utility methods.

## Write Methods

Every write method accepts a trailing options object with `tx` — a pg-promise task or transaction context to run on. Bulk methods run directly on the supplied context instead of opening their own transaction. See [Transactions](/guide/crud-operations#transactions).

```js
await db().tx(async t => {
  await db().users.insert(dto, { tx: t });
});
```

### insert(dto, options?)

Inserts a single row after validation and sanitization.

| Parameter    | Type     | Description                           |
| ------------ | -------- | ------------------------------------- |
| `dto`        | `object` | Data to insert                        |
| `options.tx` | `object` | pg-promise task/transaction to run on |

**Returns:** `Promise<Object>` — the inserted row (`RETURNING *`)
**Throws:** `SchemaDefinitionError` if validation fails or DTO is empty

### update(id, dto, options?)

Updates a record by `id`. Only the columns `dto` carries are written; every
column it omits keeps its current value.

| Parameter    | Type               | Description                                        |
| ------------ | ------------------ | -------------------------------------------------- |
| `id`         | `string \| number` | Primary key value                                  |
| `dto`        | `object`           | Columns to write. Omitted columns are not modified |
| `options.tx` | `object`           | pg-promise task/transaction to run on              |

When audit fields are enabled, `updated_at` is set to `CURRENT_TIMESTAMP` and
any value `dto` supplies for it is discarded. `updated_by` is honored if
supplied, otherwise filled from the audit actor resolver.

An empty `dto` is accepted only when audit fields are enabled — the audit
columns alone make a valid update. Without them there is nothing to write.

**Returns:** `Promise<Object | null>` — updated row, or `null` if not found
**Throws:** `SchemaDefinitionError` if validation fails

### delete(id)

Hard deletes a row by primary key.

| Parameter | Type               | Description       |
| --------- | ------------------ | ----------------- |
| `id`      | `string \| number` | Primary key value |

**Returns:** `Promise<number>` — number of rows deleted

### upsert(dto, conflictColumns, updateColumns?)

Inserts or updates on conflict.

| Parameter         | Type       | Description                                                                     |
| ----------------- | ---------- | ------------------------------------------------------------------------------- |
| `dto`             | `object`   | Data to insert or update                                                        |
| `conflictColumns` | `string[]` | Columns that define the conflict                                                |
| `updateColumns`   | `string[]` | Columns to update on conflict (optional — defaults to all non-conflict columns) |

**Returns:** `Promise<Object>` — the inserted or updated row

### deleteWhere(where)

Hard deletes rows matching a WHERE clause.

| Parameter | Type                 | Description     |
| --------- | -------------------- | --------------- |
| `where`   | `object \| Object[]` | Filter criteria |

**Returns:** `Promise<number>` — number of rows deleted

### updateWhere(where, updates, options?)

Updates rows matching a WHERE clause.

| Parameter                    | Type                 | Description                                 |
| ---------------------------- | -------------------- | ------------------------------------------- |
| `where`                      | `object \| Object[]` | Conditions                                  |
| `updates`                    | `object`             | Fields to update                            |
| `options.includeDeactivated` | `boolean`            | Include soft-deleted rows (default `false`) |

**Returns:** `Promise<number>` — number of rows updated

### touch(id, updatedBy?, options?)

Advances `updated_at`, and sets `updated_by` when an actor is known. No data
column is written.

| Parameter    | Type                         | Description                                             |
| ------------ | ---------------------------- | ------------------------------------------------------- |
| `id`         | `string \| number \| object` | Primary key — a scalar, or an object for composite keys |
| `updatedBy`  | `string`                     | Actor identifier (optional — uses resolver if omitted)  |
| `options.tx` | `object`                     | pg-promise task/transaction to run on                   |

Requires audit fields. With no actor supplied and no resolver configured the
timestamp still advances and `updated_by` is left as it was.

**Returns:** `Promise<Object | null>` — updated row, or `null` if no active row has that id
**Throws:** `SchemaDefinitionError` if audit fields are not enabled

## Bulk Methods

### bulkInsert(records, returning?)

Inserts multiple rows in a transaction.

| Parameter   | Type               | Description                  |
| ----------- | ------------------ | ---------------------------- |
| `records`   | `Object[]`         | Rows to insert               |
| `returning` | `string[] \| null` | Columns to return (optional) |

**Returns:** `Promise<number | Object[]>` — row count, or array of rows if `returning` specified

### bulkUpdate(records, returning?)

Updates multiple rows by primary key in a transaction.

| Parameter   | Type               | Description                     |
| ----------- | ------------------ | ------------------------------- |
| `records`   | `Object[]`         | Each must include an `id` field |
| `returning` | `string[] \| null` | Columns to return (optional)    |

**Returns:** `Promise<Array>` — array of row counts or row arrays

### bulkUpsert(records, conflictColumns, updateColumns?, returning?)

Bulk insert-or-update in a transaction.

| Parameter         | Type               | Description                  |
| ----------------- | ------------------ | ---------------------------- |
| `records`         | `Object[]`         | Rows to upsert               |
| `conflictColumns` | `string[]`         | Conflict columns             |
| `updateColumns`   | `string[]`         | Columns to update (optional) |
| `returning`       | `string[] \| null` | Columns to return (optional) |

**Returns:** `Promise<number | Object[]>`

## Soft Delete Methods

### removeWhere(where)

Soft deletes records by setting `deactivated_at = NOW()`.

**Returns:** `Promise<number>` — number of rows updated
**Throws:** `SchemaDefinitionError` if soft delete is not enabled (the non-standard `status: 403` property was removed in 2.0.0 — catch `SchemaDefinitionError` and map to your own HTTP status)

### restoreWhere(where)

Restores soft-deleted records by setting `deactivated_at = NULL`.

**Returns:** `Promise<number>`

### purgeSoftDeleteWhere(where?)

Permanently deletes soft-deleted rows matching conditions.

**Returns:** `Promise<Object>` — pg-promise result

### purgeSoftDeleteById(id, options?)

Permanently deletes a specific soft-deleted row. Only removes rows that are
already deactivated.

| Parameter    | Type         | Description                             |
| ------------ | ------------ | --------------------------------------- |
| `id`         | `PrimaryKey` | Scalar, or an object for composite keys |
| `options.tx` | `object`     | pg-promise task/transaction to run on   |

**Returns:** `Promise<Object>` — pg-promise result
**Throws:** `Error` if soft delete is not enabled; `SchemaDefinitionError` if the
key does not match the declared one

## Import/Export

### importFromSpreadsheet(filePath, sheetIndex?, callbackFn?, returning?)

Imports data from an Excel file into the table.

| Parameter    | Type              | Default | Description                |
| ------------ | ----------------- | ------- | -------------------------- |
| `filePath`   | `string`          | —       | Source `.xlsx` file path   |
| `sheetIndex` | `number`          | `0`     | Sheet index (0-based)      |
| `callbackFn` | `(row) => Object` | `null`  | Transform function per row |
| `returning`  | `string[]`        | `null`  | Columns to return          |

**Returns:** `Promise<{ inserted: number | Object[] }>`

## Schema Management

### createTable()

Creates the table from the schema definition, including indexes.

**Returns:** `Promise<void>`

### truncate()

Truncates the table and resets identity sequences.

**Returns:** `Promise<void>`
