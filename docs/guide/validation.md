# Validation

pg-schemata automatically generates [Zod](https://zod.dev/) validators from your schema definition and uses them to validate DTOs before insert and update operations.

## Auto-generated validators

When a `TableModel` is constructed, pg-schemata generates two Zod validators from the schema:

- **insertValidator** — validates data for `insert()` and `bulkInsert()`
- **updateValidator** — validates data for `update()`, `updateWhere()`, and `bulkUpdate()`

These are stored at `model._schema.validators`.

### Type mapping

Type names are normalized before matching — trimmed, lowercased, and interior
whitespace collapsed — so `DOUBLE   PRECISION` and `double precision` are the
same type.

| PostgreSQL Type                                                                    | Zod Type                           |
| ---------------------------------------------------------------------------------- | ---------------------------------- |
| `text`, `varchar`, `character varying`, `char`, `bpchar`, `character`, `citext`    | `z.string()`                       |
| `varchar(n)`, `character varying(n)`, `char(n)`, `bpchar(n)`, `character(n)`       | `z.string().max(n)`                |
| `uuid`                                                                             | `z.guid()`                         |
| `smallint`, `int2`, `int`, `integer`, `int4`, `smallserial`, `serial`, `serial2/4` | `z.number().int()`                 |
| `bigint`, `int8`, `bigserial`, `serial8`                                           | number \| bigint \| digit string   |
| `numeric`, `decimal` (sized or not)                                                | number \| numeric string           |
| `real`, `float4`, `float8`, `double precision`, `float`, `float(n)`                | `z.number()`                       |
| `boolean`, `bool`                                                                  | `z.boolean()`                      |
| `date`, `timestamp`, `timestamptz` (sized, `with`/`without time zone`)             | `z.coerce.date()`                  |
| `time`, `timetz` (sized, `with`/`without time zone`)                               | `z.string()` with a time regex     |
| `json`, `jsonb`                                                                    | `z.unknown().nonoptional()`        |
| `inet`, `cidr`, `macaddr`, `macaddr8`                                              | `z.string()`                       |
| any of the above with `[]`                                                         | `z.array(<element>)`               |
| `interval`, `bytea`                                                                | **throws** — see below             |
| anything else                                                                      | **throws** `SchemaDefinitionError` |

An unmapped type is a schema-definition error rather than a silent `z.any()`:
a validator that accepts anything looks like protection while providing none.
Supply `colProps.validator` for types the generator does not cover.

### Why `time` is a string

`pg` leaves `time` and `timetz` unparsed, so a `time` column round-trips as the
string `'07:00:00'`. `new Date('07:00:00')` is `Invalid Date`, so
`z.coerce.date()` would reject every `time` column in existence. This is a
deliberate asymmetry with `timestamp` and `date`, which stay `z.coerce.date()`
because `pg` _does_ parse those into `Date` objects.

The pattern is hand-rolled rather than `z.iso.time()`, which rejects
`24:00:00` — a legal end-of-day value PostgreSQL accepts and stores. Seconds
are optional and fractional seconds are unbounded. A plain `time` column
rejects a trailing offset, because PostgreSQL silently discards it.

Exotic input literals PostgreSQL accepts (`'04:05 PM'`, `'allballs'`) are not
matched; use `colProps.validator` for those.

### Arrays are one-dimensional only

`text[]`, `uuid[]`, and `varchar(10)[]` map to `z.array(...)` with the element
validator intact, so `varchar(10)[]` still enforces the per-element length.

**Elements are always nullable.** PostgreSQL arrays may contain `NULL`, and the
column type cannot forbid it — `text[] NOT NULL` constrains the array, not its
contents — so `['a', null]` is a legal `text[]` value that `pg` returns as
`['a', null]`. The element validator allows `null` accordingly; the column's own
nullability is unaffected. Use a CHECK constraint if you need to exclude them.

`text[][]` throws. PostgreSQL does not enforce declared array dimensions —
`text[][]` and `text[]` are the same type, and a `text[][]` column happily
stores a flat array — so a nested `z.array(z.array(...))` would reject rows the
database accepts.

`_text` throws too, naming `text[]` as the intended spelling. It is the
`pg_type` internal name for `text[]`, but it is also a legal user-defined type
identifier, so guessing would eventually be wrong.

Inserting into a typed array column needs a cast, because `pg-promise` renders
a JavaScript array as a `text[]` literal:

```js
{ name: 'related_ids', type: 'uuid[]', colProps: { cast: 'uuid[]' } }
```

### `interval` and `bytea` are unmapped by design

Both round-trip asymmetrically: `pg` returns an object (`interval`) or a
`Buffer` (`bytea`), while inserts accept a string. Any built-in validator would
have to be a union broad enough to accept nearly anything, which is worse than
no validator at all. Use `colProps.validator`.

### Validators gate, they do not transform

Validation runs against the DTO, but the **original** DTO is what reaches the
database — pg-schemata never substitutes Zod's parsed output. So a `timestamptz`
column accepts an ISO string and passes it through as a string for PostgreSQL to
parse; the `Date` that `z.coerce.date()` produced is discarded.

This matters if you supply a `colProps.validator` that transforms
(`.transform()`, `.default()`, `.catch()`): the transformation is applied during
validation and then thrown away. Use validators that check rather than rewrite.

### Nullability and defaults

- Columns with `notNull: true` and no `default` → required
- Columns with `default` → optional (`.optional()`)
- `serial`, `serial2/4/8`, `smallserial`, and `bigserial` count as having a default even
  when none is declared — PostgreSQL generates the value — so they are never required on
  insert, and they are excluded from the ColumnSet entirely
- Columns without `notNull` → nullable (`.nullable().optional()`)
- Immutable columns are excluded from the update validator

### Check constraints

Two CHECK shapes are read and folded into the validator, and both apply to the
column's own type before nullability wrapping — so a nullable column keeps
accepting `null`:

- `char_length(col) > n` → `.min(n + 1)` on a string column
- `col IN ('a', 'b')` → an allow-list refinement layered on the mapped type,
  rather than a replacement `z.enum(['a', 'b'])`. The column keeps whatever it
  already had — `varchar(n)`'s `.max(n)`, the automatic `z.email()` check, a
  `colProps.validator` — instead of losing it to the enum

Both are ignored for non-string columns, and both are read only in exactly the
forms above: a compound expression such as
`char_length(code) > 3 OR code = 'x'` is left uninterpreted, since the database
accepts values the isolated fragment would reject. Anything more complex is
left to the database.

## Manual validation

Use `validateDto()` to validate data against any Zod schema:

```js
const model = db().users;

// Validate a single DTO
model.validateDto(
  { email: 'alice@example.com' },
  model._schema.validators.insertValidator,
  'Insert DTO' // label for error messages
);

// Validate an array of DTOs
model.validateDto(
  [dto1, dto2, dto3],
  model._schema.validators.insertValidator,
  'Bulk Insert DTO'
);
```

Throws `SchemaDefinitionError` with `.cause` containing the Zod error details.

### The `.cause` shape

`.cause` is the array of Zod **issues** — `ZodError.issues`, not the `ZodError`
itself. Each issue carries at least `path` and `code`:

```js
try {
  model.validateDto({ email: 123 }, model._schema.validators.insertValidator);
} catch (err) {
  err.cause; // [{ code: 'invalid_type', path: ['email'], ... }]
}
```

For an array payload the path is prefixed with the record index, e.g.
`[1, 'email']`.

Before 3.0.0 this was populated from `ZodError.errors`, which zod 4 removed.
If a non-Zod error caused the failure, `.cause` is that error unchanged.

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
      name: 'age',
      type: 'integer',
      colProps: {
        validator: z.number().int().min(0).max(150), // narrower than z.number().int()
      },
    },
    {
      name: 'duration',
      type: 'interval', // unmapped by design — a validator is required
      colProps: {
        validator: z.string(),
      },
    },
  ],
};
```

The custom validator replaces the auto-generated one for that column in both the insert
and update validators. It also bypasses the type mapping entirely, which is the supported
escape hatch for `interval`, `bytea`, and any type the generator does not cover.

### Automatic email validation

A column literally named `email` whose validator is a string gets `z.email()` added
automatically, composed onto whatever the type mapping produced — so a
`varchar(255)` email column validates as `z.string().max(255)` **and** as an address.
No configuration is needed, and overriding it with `colProps.validator` will usually
make the column _less_ strict, not more.

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
