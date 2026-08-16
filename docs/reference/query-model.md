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

| Parameter | Type          | Description                                           |
| --------- | ------------- | ----------------------------------------------------- |
| `db`      | `IDatabase`   | pg-promise database or transaction instance           |
| `pgp`     | `IMain`       | pg-promise library instance                           |
| `schema`  | `TableSchema` | Schema definition object                              |
| `logger`  | `object`      | Optional logger with `.error()` and `.info()` methods |

## Query Methods

### findAll(options?)

Fetches all rows with optional pagination.

| Option   | Type     | Default | Description            |
| -------- | -------- | ------- | ---------------------- |
| `limit`  | `number` | `50`    | Maximum rows to return |
| `offset` | `number` | `0`     | Rows to skip           |

**Returns:** `Promise<Object[]>`

### findById(id)

Finds a single row by primary key.

| Parameter | Type               | Description       |
| --------- | ------------------ | ----------------- |
| `id`      | `string \| number` | Primary key value |

**Returns:** `Promise<Object | null>`
**Throws:** `Error` if ID is invalid

### findByIdIncludingDeactivated(id)

Same as `findById` but includes soft-deleted records.

### findOneBy(conditions, options?)

Finds the first row matching the given conditions. Always queries with
`LIMIT 1`.

| Parameter    | Type       | Description                                     |
| ------------ | ---------- | ----------------------------------------------- |
| `conditions` | `Object[]` | Array of condition objects                      |
| `options`    | `object`   | Same as `findWhere` options; `limit` is ignored |

**Returns:** `Promise<Object | null>`

### findWhere(conditions?, joinType?, options?)

Finds rows matching conditions with full query options.

| Parameter                    | Type                 | Default | Description                                                                |
| ---------------------------- | -------------------- | ------- | -------------------------------------------------------------------------- |
| `conditions`                 | `Object[] \| Object` | `[]`    | Condition objects; a single plain object is treated as a one-element array |
| `joinType`                   | `string`             | `'AND'` | `'AND'` or `'OR'`                                                          |
| `options.columnWhitelist`    | `string[]`           | `null`  | Columns to return                                                          |
| `options.filters`            | `object`             | `{}`    | Additional filter object                                                   |
| `options.orderBy`            | `string \| string[]` | `null`  | Sort columns                                                               |
| `options.limit`              | `number`             | `null`  | Row limit                                                                  |
| `options.offset`             | `number`             | `null`  | Row offset                                                                 |
| `options.includeDeactivated` | `boolean`            | `false` | Include soft-deleted rows                                                  |

**Returns:** `Promise<Object[]>`

### findAfterCursor(cursor?, limit?, orderBy?, options?)

Keyset-based cursor pagination.

| Parameter                    | Type       | Default  | Description                                                |
| ---------------------------- | ---------- | -------- | ---------------------------------------------------------- |
| `cursor`                     | `object`   | `{}`     | Cursor values keyed by orderBy columns                     |
| `limit`                      | `number`   | `50`     | Maximum rows                                               |
| `orderBy`                    | `string[]` | `['id']` | Columns for ordering                                       |
| `options.descending`         | `boolean`  | `false`  | Descending order. Applies to **every** column in `orderBy` |
| `options.columnWhitelist`    | `string[]` | `null`   | Columns to return. Must include every `orderBy` column     |
| `options.filters`            | `object`   | `{}`     | Additional filters                                         |
| `options.includeDeactivated` | `boolean`  | `false`  | Include soft-deleted rows                                  |

**Returns:** `Promise<{ rows: Object[], nextCursor: Object | null }>`

`nextCursor` is `null` on the last page, including one holding exactly `limit`
rows: the query fetches `limit + 1` rows and uses the extra one only to decide
whether another page exists, returning at most `limit`. A caller can loop on the
cursor without an extra empty round trip.

**Throws:** `SchemaDefinitionError` if `columnWhitelist` omits an `orderBy`
column. The cursor is read off the last returned row, so an ordering column
that is not projected would produce a cursor that cannot be passed back in.

### findSoftDeleted(conditions?, joinType?, options?)

Returns only soft-deleted records.

**Returns:** `Promise<Object[]>`
**Throws:** `Error` if soft delete is not enabled

### isSoftDeleted(id)

Checks if a record is soft-deleted.

**Returns:** `Promise<boolean>`

## Aggregation Methods

### countWhere(conditions?, joinType?, options?)

Counts rows matching conditions.

| Parameter                    | Type                 | Default |
| ---------------------------- | -------------------- | ------- |
| `conditions`                 | `Object[] \| Object` | `[]`    |
| `joinType`                   | `string`             | `'AND'` |
| `options.filters`            | `object`             | `{}`    |
| `options.includeDeactivated` | `boolean`            | `false` |

A single plain object is treated as a one-element array. Anything else throws `SchemaDefinitionError`.

**Returns:** `Promise<number>`

### countAll(options?)

Counts all rows in the table.

**Returns:** `Promise<number>`

### exists(conditions, options?)

Checks if any row matches the given conditions.

| Parameter    | Type     | Description                |
| ------------ | -------- | -------------------------- |
| `conditions` | `object` | Non-empty condition object |

**Returns:** `Promise<boolean>`

## Utility Methods

### sanitizeDto(dto, options?)

Returns a filtered copy of the DTO containing only valid column names.

| Option             | Type      | Default | Description               |
| ------------------ | --------- | ------- | ------------------------- |
| `includeImmutable` | `boolean` | `true`  | Include immutable columns |

### validateDto(data, validator, type?)

Validates a DTO or array of DTOs against a Zod schema.

**Throws:** `SchemaDefinitionError` with `.cause` set to the Zod issues array (`ZodError.issues`)

### buildWhereClause(where, requireNonEmpty?, values?, joinType?, includeDeactivated?)

Builds a SQL WHERE clause from conditions.

When soft delete is enabled and `includeDeactivated` is false, the returned
clause is parenthesized before the `deactivated_at IS NULL` guard is appended —
`("a" = $1 OR "b" = $2) AND deactivated_at IS NULL`. Without the parentheses
`AND` would bind tighter than `OR` and the guard would cover only the last
disjunct.

**Returns:** `{ clause: string, values: any[] }`

### buildCondition(group, joiner?, values?)

Builds a SQL fragment from a group of condition objects.

An object carrying `$and` or `$or` also emits any ordinary column keys beside
it, joined by `joiner` — see
[boolean groups alongside plain columns](/guide/where-modifiers#boolean-groups-alongside-plain-columns).

**Returns:** `string`
**Throws:** `SchemaDefinitionError` if `joiner` is not exactly `'AND'` or
`'OR'`. `JoinType` erases at compile time and the value is interpolated between
predicates as raw SQL, so it is checked at runtime as well.

### buildValuesClause(data)

Generates a SQL-safe VALUES clause using the model's ColumnSet.

### escapeName(name)

Escapes a column or table name using pg-promise.

### forSchema(name)

Returns a model bound to the given schema without mutating this instance. Clones are cached per `(instance, schema)` pair, and the returned model's ColumnSet is built for the target schema.

**Returns:** This instance if already bound to `name`, otherwise a cached clone

### reload(id, options?)

Reloads a record by ID. Pass `{ includeDeactivated: true }` to include soft-deleted records; `findById` does not take options.

### exportToSpreadsheet(filePath, where?, joinType?, options?)

Exports query results to an `.xlsx` file.

**Returns:** `Promise<{ exported: number, filePath: string }>`

## Properties

| Property     | Type          | Description                    |
| ------------ | ------------- | ------------------------------ |
| `schema`     | `TableSchema` | The full schema definition     |
| `schemaName` | `string`      | Escaped PostgreSQL schema name |
| `tableName`  | `string`      | Escaped table name             |
