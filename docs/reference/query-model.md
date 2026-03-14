# QueryModel

Read-only query interface for PostgreSQL tables. Use directly for read-only access, or extend via `TableModel` for full CRUD.

**Import:**

```js
import { QueryModel } from 'pg-schemata';
```

## Constructor

```js
new QueryModel(db, pgp, schema, logger?)
```

| Parameter | Type | Description |
|---|---|---|
| `db` | `IDatabase` | pg-promise database or transaction instance |
| `pgp` | `IMain` | pg-promise library instance |
| `schema` | `TableSchema` | Schema definition object |
| `logger` | `object` | Optional logger with `.error()` and `.info()` methods |

## Query Methods

### findAll(options?)

Fetches all rows with optional pagination.

| Option | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` | `50` | Maximum rows to return |
| `offset` | `number` | `0` | Rows to skip |

**Returns:** `Promise<Object[]>`

### findById(id)

Finds a single row by primary key.

| Parameter | Type | Description |
|---|---|---|
| `id` | `string \| number` | Primary key value |

**Returns:** `Promise<Object | null>`
**Throws:** `Error` if ID is invalid

### findByIdIncludingDeactivated(id)

Same as `findById` but includes soft-deleted records.

### findOneBy(conditions, options?)

Finds the first row matching the given conditions.

| Parameter | Type | Description |
|---|---|---|
| `conditions` | `Object[]` | Array of condition objects |
| `options` | `object` | Same as `findWhere` options |

**Returns:** `Promise<Object | null>`

### findWhere(conditions?, joinType?, options?)

Finds rows matching conditions with full query options.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `conditions` | `Object[]` | `[]` | Array of condition objects |
| `joinType` | `string` | `'AND'` | `'AND'` or `'OR'` |
| `options.columnWhitelist` | `string[]` | `null` | Columns to return |
| `options.filters` | `object` | `{}` | Additional filter object |
| `options.orderBy` | `string \| string[]` | `null` | Sort columns |
| `options.limit` | `number` | `null` | Row limit |
| `options.offset` | `number` | `null` | Row offset |
| `options.includeDeactivated` | `boolean` | `false` | Include soft-deleted rows |

**Returns:** `Promise<Object[]>`

### findAfterCursor(cursor?, limit?, orderBy?, options?)

Keyset-based cursor pagination.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `cursor` | `object` | `{}` | Cursor values keyed by orderBy columns |
| `limit` | `number` | `50` | Maximum rows |
| `orderBy` | `string[]` | `['id']` | Columns for ordering |
| `options.descending` | `boolean` | `false` | Descending order |
| `options.columnWhitelist` | `string[]` | `null` | Columns to return |
| `options.filters` | `object` | `{}` | Additional filters |
| `options.includeDeactivated` | `boolean` | `false` | Include soft-deleted rows |

**Returns:** `Promise<{ rows: Object[], nextCursor: Object | null }>`

### findSoftDeleted(conditions?, joinType?, options?)

Returns only soft-deleted records.

**Returns:** `Promise<Object[]>`
**Throws:** `Error` if soft delete is not enabled

### isSoftDeleted(id)

Checks if a record is soft-deleted.

**Returns:** `Promise<boolean>`

## Aggregation Methods

### count(conditions?, joinType?, options?)

Alias for `countWhere`.

### countWhere(conditions?, joinType?, options?)

Counts rows matching conditions.

| Parameter | Type | Default |
|---|---|---|
| `conditions` | `Object[]` | `[]` |
| `joinType` | `string` | `'AND'` |
| `options.filters` | `object` | `{}` |
| `options.includeDeactivated` | `boolean` | `false` |

**Returns:** `Promise<number>`

### countAll(options?)

Counts all rows in the table.

**Returns:** `Promise<number>`

### exists(conditions, options?)

Checks if any row matches the given conditions.

| Parameter | Type | Description |
|---|---|---|
| `conditions` | `object` | Non-empty condition object |

**Returns:** `Promise<boolean>`

## Utility Methods

### sanitizeDto(dto, options?)

Returns a filtered copy of the DTO containing only valid column names.

| Option | Type | Default | Description |
|---|---|---|---|
| `includeImmutable` | `boolean` | `true` | Include immutable columns |

### validateDto(data, validator, type?)

Validates a DTO or array of DTOs against a Zod schema.

**Throws:** `SchemaDefinitionError` with `.cause` containing Zod details

### buildWhereClause(where, requireNonEmpty?, values?, joinType?, includeDeactivated?)

Builds a SQL WHERE clause from conditions.

**Returns:** `{ clause: string, values: any[] }`

### buildCondition(group, joiner?, values?)

Builds a SQL fragment from a group of condition objects.

**Returns:** `string`

### buildValuesClause(data)

Generates a SQL-safe VALUES clause using the model's ColumnSet.

### escapeName(name)

Escapes a column or table name using pg-promise.

### setSchemaName(name)

Changes the PostgreSQL schema and regenerates the ColumnSet.

**Returns:** The model instance (for chaining)

### reload(id, options?)

Reloads a record by ID. Alias for `findById`.

### exportToSpreadsheet(filePath, where?, joinType?, options?)

Exports query results to an `.xlsx` file.

**Returns:** `Promise<{ exported: number, filePath: string }>`

## Properties

| Property | Type | Description |
|---|---|---|
| `schema` | `TableSchema` | The full schema definition |
| `schemaName` | `string` | Escaped PostgreSQL schema name |
| `tableName` | `string` | Escaped table name |
