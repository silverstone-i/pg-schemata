# Validation

pg-schemata automatically generates [Zod](https://zod.dev/) validators from your schema definition and uses them to validate DTOs before insert and update operations.

## Auto-generated validators

When a `TableModel` is constructed, pg-schemata generates two Zod validators from the schema:

- **insertValidator** — validates data for `insert()` and `bulkInsert()`
- **updateValidator** — validates data for `update()`, `updateWhere()`, and `bulkUpdate()`

These are stored at `model._schema.validators`.

### Type mapping

The generator maps PostgreSQL types to Zod types:

| PostgreSQL Type | Zod Type |
|---|---|
| `integer`, `int`, `smallint`, `bigint`, `serial`, `bigserial` | `z.number()` or `z.coerce.number()` |
| `numeric`, `decimal`, `real`, `double precision`, `float` | `z.number()` |
| `boolean` | `z.boolean()` |
| `uuid` | `z.string().uuid()` |
| `json`, `jsonb` | `z.any()` |
| `date`, `timestamp`, `timestamptz` | `z.coerce.date()` |
| `varchar(n)`, `char(n)` | `z.string().max(n)` |
| `text`, `varchar` (no length) | `z.string()` |
| Other | `z.any()` |

### Nullability and defaults

- Columns with `notNull: true` and no `default` → required
- Columns with `default` → optional (`.optional()`)
- Columns without `notNull` → nullable (`.nullable().optional()`)
- Immutable columns are excluded from the update validator

## Manual validation

Use `validateDto()` to validate data against any Zod schema:

```js
const model = db().users;

// Validate a single DTO
model.validateDto(
  { email: 'alice@example.com' },
  model._schema.validators.insertValidator,
  'Insert DTO'  // label for error messages
);

// Validate an array of DTOs
model.validateDto(
  [dto1, dto2, dto3],
  model._schema.validators.insertValidator,
  'Bulk Insert DTO'
);
```

Throws `SchemaDefinitionError` with `.cause` containing the Zod error details.

## Sanitizing DTOs

`sanitizeDto()` filters out unknown columns from a DTO:

```js
const model = db().users;

const safe = model.sanitizeDto({
  email: 'alice@example.com',
  unknown_field: 'ignored',
  id: 'some-uuid',
});
// { email: 'alice@example.com', id: 'some-uuid' }
```

### Excluding immutable columns

On updates, use `includeImmutable: false` to strip immutable columns:

```js
const safe = model.sanitizeDto(dto, { includeImmutable: false });
// Removes columns with immutable: true (e.g., id)
```

This is what `update()` does internally.

## Custom validators

Override the auto-generated validator for specific columns using `colProps.validator`:

```js
import { z } from 'zod';

const schema = {
  // ...
  columns: [
    {
      name: 'email',
      type: 'varchar(255)',
      notNull: true,
      colProps: {
        validator: z.string().email(),  // stricter than the default z.string().max(255)
      },
    },
    {
      name: 'age',
      type: 'integer',
      colProps: {
        validator: z.number().int().min(0).max(150),
      },
    },
  ],
};
```

The custom validator replaces the auto-generated one for that column in both the insert and update validators.

## buildValuesClause

Generate a SQL-safe `VALUES` clause for raw query usage:

```js
const model = db().users;
const values = model.buildValuesClause([
  { email: 'alice@example.com', first_name: 'Alice' },
  { email: 'bob@example.com', first_name: 'Bob' },
]);
// Returns a pg-promise formatted VALUES string
```

This uses the model's ColumnSet to ensure proper formatting and escaping.
