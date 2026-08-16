# Schema Definition

The schema object is the core concept in pg-schemata. It defines your table structure, constraints, and behavioral flags in a single JavaScript object.

## TableSchema

Every model requires a schema object with these properties:

| Property         | Type                           | Required | Description                                                 |
| ---------------- | ------------------------------ | -------- | ----------------------------------------------------------- |
| `dbSchema`       | `string`                       | Yes      | PostgreSQL schema name (e.g. `'public'`)                    |
| `table`          | `string`                       | Yes      | Table name                                                  |
| `columns`        | `ColumnDefinition[]`           | Yes      | Array of column definitions                                 |
| `constraints`    | `Constraints`                  | No       | Primary key, unique, foreign keys, checks, indexes          |
| `hasAuditFields` | `boolean \| AuditFieldsConfig` | No       | Adds `created_at`, `updated_at`, `created_by`, `updated_by` |
| `softDelete`     | `boolean`                      | No       | Adds `deactivated_at` column for soft deletes               |
| `version`        | `string`                       | No       | Schema version string for tracking                          |

## ColumnDefinition

Each column is defined as an object in the `columns` array:

| Property     | Type       | Required | Description                                                                                     |
| ------------ | ---------- | -------- | ----------------------------------------------------------------------------------------------- |
| `name`       | `string`   | Yes      | Column name                                                                                     |
| `type`       | `string`   | Yes      | PostgreSQL data type (`'uuid'`, `'varchar(255)'`, `'integer'`, `'jsonb'`, etc.)                 |
| `notNull`    | `boolean`  | No       | Whether the column rejects null values. Defaults to `false`                                     |
| `default`    | `any`      | No       | Default value — a SQL expression as a string (e.g. `'gen_random_uuid()'`, `'true'`, `"'user'"`) |
| `immutable`  | `boolean`  | No       | If `true`, excluded from update operations                                                      |
| `generated`  | `'always'` | No       | Marks the column as a generated column. Requires `expression` and `stored: true`                |
| `expression` | `string`   | No       | SQL expression for generated columns                                                            |
| `stored`     | `boolean`  | No       | Must be `true` when `generated` is set                                                          |
| `colProps`   | `object`   | No       | pg-promise column behavior modifiers                                                            |

### Generated columns

PostgreSQL has exactly one valid form for a generated expression:

```js
{
  name: 'schema_name',
  type: 'varchar(63)',
  generated: 'always',
  expression: 'lower(tenant_code)',
  stored: true,
}
// "schema_name" varchar(63) GENERATED ALWAYS AS (lower(tenant_code)) STORED
```

`generated` takes only `'always'` — `BY DEFAULT` applies to identity columns,
not generated expressions. `stored: true` is required: virtual generated
columns arrived in PostgreSQL 18, and the supported floor is 13.

Omitting either throws `SchemaDefinitionError` at table creation, rather than
producing DDL the server rejects.

### colProps

The `colProps` object controls how pg-promise handles the column in insert and update operations:

| Property    | Type               | Description                                                                                                  |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `mod`       | `string`           | pg-promise format modifier (e.g. `':json'` for JSONB columns)                                                |
| `cast`      | `string`           | SQL type appended as a cast (e.g. `'uuid[]'`). Required for typed array columns — see below                  |
| `skip`      | `(col) => boolean` | Skip this column conditionally. Common pattern: `c => !c.exists` skips the column if not provided in the DTO |
| `cnd`       | `boolean`          | Use this column in the conditional update clause                                                             |
| `init`      | `(dto) => any`     | Function to compute the value dynamically at insert/update time                                              |
| `def`       | `string`           | Override the default value in pg-promise's ColumnSet                                                         |
| `validator` | `ZodSchema`        | Custom Zod validator for this specific column                                                                |

### Typed array columns need `cast`

pg-promise renders a JavaScript array as a `text[]` literal, and PostgreSQL will not
implicitly cast that to `uuid[]` — an insert fails with
`column "related_ids" is of type uuid[] but expression is of type text[]`. Add the cast:

```js
{ name: 'related_ids', type: 'uuid[]', colProps: { cast: 'uuid[]' } }
```

`text[]` columns need no cast, since that is already the rendered type.

## Constraints

Define table-level constraints in the `constraints` object:

```js
constraints: {
  primaryKey: ['id'],

  unique: [
    ['email'],                         // simple unique constraint
    ['tenant_id', 'code'],             // composite unique
    { columns: ['sku'], nullsNotDistinct: true },  // PostgreSQL 15+
  ],

  foreignKeys: [
    {
      type: 'ForeignKey',
      columns: ['tenant_id'],
      references: { table: 'admin.tenants(id)', column: ['id'] },
      onDelete: 'CASCADE',
    },
  ],

  checks: [
    { type: 'Check', expression: "char_length(email) > 3" },
    { type: 'Check', expression: "role IN ('user', 'admin', 'moderator')" },
  ],

  indexes: [
    { type: 'Index', columns: ['email'] },
    { type: 'Index', columns: ['tenant_id', 'role'] },
  ],
}
```

### Constraint types

| Property      | Type                                         | Description                                                           |
| ------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `primaryKey`  | `string[]`                                   | Column names for the primary key. See the note below                  |
| `unique`      | `(string[] \| UniqueConstraintDefinition)[]` | Unique constraints — simple arrays or objects with `nullsNotDistinct` |
| `foreignKeys` | `ConstraintDefinition[]`                     | Foreign key references with optional `onDelete` behavior              |
| `checks`      | `ConstraintDefinition[]`                     | SQL check expressions                                                 |

| `indexes` | `IndexDefinition[]` | Index definitions for query optimization |

::: info
Check expressions and index predicates are deliberately raw SQL — they are emitted into the DDL as written. Column `default` strings, by contrast, are quoted and escaped when they are not a function call, number, or already-quoted literal.
:::

### Primary keys drive row targeting

`constraints.primaryKey` generates the `PRIMARY KEY` constraint **and** tells
`findById`, `update`, `delete`, `bulkUpdate`, `reload` and the soft-delete
helpers which columns identify a row. The column does not have to be called
`id`:

```js
// Keyed on `code`
constraints: {
  primaryKey: ['code'];
}

await coupons.findById('SAVE10'); // WHERE "code" = 'SAVE10'
```

Composite keys are supported. Pass an object carrying every key column:

```js
constraints: {
  primaryKey: ['tenant_id', 'user_id'];
}

await memberships.findById({ tenant_id, user_id });
// WHERE "tenant_id" = $1 AND "user_id" = $2
```

A scalar is only accepted for single-column keys; passing one to a
composite-key model throws `SchemaDefinitionError` naming the columns to supply.
`bulkUpdate` reads the key columns off each record and keeps them out of the
`SET` list.

::: warning Changed in 3.0.0
Before 3.0.0 every by-id method emitted `WHERE id = $1` against a column
literally named `id`, whatever `primaryKey` declared. A table keyed on anything
else got a correct constraint and silently wrong targeting, and a composite key
matched on `id` alone. `constraints.primaryKey` must now be an array of column
names — a bare string throws, where it was previously ignored.
:::

::: warning Removed — these throw at model construction
Declaring `indexes` at the top level of the schema (outside `constraints`) and
the `schemaName` alias for `dbSchema` were removed in 2.0.0 after warning at
runtime in 1.8.0, along with the column key `nullable`.

As of 3.0.0 a schema still using **top-level `indexes`** throws
`SchemaDefinitionError` at model construction rather than being silently
ignored — 2.0.0 dropped every such index, including unique and partial-unique
ones, with no signal until duplicate rows appeared. An empty `indexes: []`
throws too.

```diff
- indexes: [{ columns: ['email'], unique: true }],
+ constraints: { indexes: [{ columns: ['email'], unique: true }] },
```

A column still passing `nullable` also throws; use `notNull`
(`nullable: false` becomes `notNull: true`).
:::

## Audit fields

When `hasAuditFields` is enabled, pg-schemata automatically adds four columns to your schema:

- `created_at` — `timestamptz`, defaults to `NOW()`
- `updated_at` — `timestamptz`, defaults to `NOW()`
- `created_by` — user identifier, set on insert
- `updated_by` — user identifier, set on update

### Boolean format (simple)

```js
hasAuditFields: true;
```

Uses `varchar(50)` for `created_by` / `updated_by` with a default fallback of `'system'`.

### Object format (configurable)

```js
hasAuditFields: {
  enabled: true,
  userFields: {
    type: 'uuid',        // PostgreSQL type for user fields
    nullable: true,      // allow null
    default: null,       // default value
  },
}
```

See [Audit Fields](/guide/audit-fields) for the full audit actor resolver pattern.

## Soft delete

Setting `softDelete: true` adds a `deactivated_at` (`timestamptz`) column. When enabled:

- `delete()` only affects non-deactivated rows
- All `find*` methods exclude deactivated rows by default
- Use `removeWhere()` to soft delete and `restoreWhere()` to restore
- Pass `{ includeDeactivated: true }` to include soft-deleted rows in queries

See [Soft Delete](/guide/soft-delete) for details.

## Complete example

```js
const usersSchema = {
  dbSchema: 'public',
  table: 'users',
  hasAuditFields: true,
  softDelete: true,
  version: '1.0.0',
  columns: [
    {
      name: 'id',
      type: 'uuid',
      default: 'gen_random_uuid()',
      notNull: true,
      immutable: true,
      colProps: { cnd: true },
    },
    {
      name: 'tenant_id',
      type: 'uuid',
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'email',
      type: 'varchar(255)',
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'first_name',
      type: 'varchar(100)',
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'last_name',
      type: 'varchar(100)',
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'address',
      type: 'jsonb',
      colProps: { mod: ':json', skip: c => !c.exists },
    },
    {
      name: 'is_active',
      type: 'boolean',
      default: 'true',
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
    {
      name: 'role',
      type: 'varchar(50)',
      default: "'user'",
      notNull: true,
      colProps: { skip: c => !c.exists },
    },
  ],
  constraints: {
    primaryKey: ['id'],
    unique: [['tenant_id', 'email']],
    foreignKeys: [
      {
        type: 'ForeignKey',
        columns: ['tenant_id'],
        references: { table: 'admin.tenants(id)', column: ['id'] },
        onDelete: 'CASCADE',
      },
    ],
    checks: [
      { type: 'Check', expression: 'char_length(email) > 3' },
      { type: 'Check', expression: "role IN ('user', 'admin', 'moderator')" },
    ],
    indexes: [
      { type: 'Index', columns: ['email'] },
      { type: 'Index', columns: ['tenant_id', 'role'] },
    ],
  },
};
```
