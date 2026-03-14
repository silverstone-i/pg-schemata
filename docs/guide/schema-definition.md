# Schema Definition

The schema object is the core concept in pg-schemata. It defines your table structure, constraints, and behavioral flags in a single JavaScript object.

## TableSchema

Every model requires a schema object with these properties:

| Property | Type | Required | Description |
|---|---|---|---|
| `dbSchema` | `string` | Yes | PostgreSQL schema name (e.g. `'public'`) |
| `table` | `string` | Yes | Table name |
| `columns` | `ColumnDefinition[]` | Yes | Array of column definitions |
| `constraints` | `Constraints` | No | Primary key, unique, foreign keys, checks, indexes |
| `hasAuditFields` | `boolean \| AuditFieldsConfig` | No | Adds `created_at`, `updated_at`, `created_by`, `updated_by` |
| `softDelete` | `boolean` | No | Adds `deactivated_at` column for soft deletes |
| `version` | `string` | No | Schema version string for tracking |

## ColumnDefinition

Each column is defined as an object in the `columns` array:

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Column name |
| `type` | `string` | Yes | PostgreSQL data type (`'uuid'`, `'varchar(255)'`, `'integer'`, `'jsonb'`, etc.) |
| `notNull` | `boolean` | No | Whether the column rejects null values. Defaults to `false` |
| `default` | `any` | No | Default value — a SQL expression as a string (e.g. `'gen_random_uuid()'`, `'true'`, `"'user'"`) |
| `immutable` | `boolean` | No | If `true`, excluded from update operations |
| `generated` | `'always' \| 'by default'` | No | Marks the column as a generated column |
| `expression` | `string` | No | SQL expression for generated columns |
| `colProps` | `object` | No | pg-promise column behavior modifiers |

### colProps

The `colProps` object controls how pg-promise handles the column in insert and update operations:

| Property | Type | Description |
|---|---|---|
| `mod` | `string` | pg-promise format modifier (e.g. `':json'` for JSONB columns) |
| `skip` | `(col) => boolean` | Skip this column conditionally. Common pattern: `c => !c.exists` skips the column if not provided in the DTO |
| `cnd` | `boolean` | Use this column in the conditional update clause |
| `init` | `(dto) => any` | Function to compute the value dynamically at insert/update time |
| `def` | `string` | Override the default value in pg-promise's ColumnSet |
| `validator` | `ZodSchema` | Custom Zod validator for this specific column |

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

| Property | Type | Description |
|---|---|---|
| `primaryKey` | `string[]` | Column names for the primary key |
| `unique` | `(string[] \| UniqueConstraintDefinition)[]` | Unique constraints — simple arrays or objects with `nullsNotDistinct` |
| `foreignKeys` | `ConstraintDefinition[]` | Foreign key references with optional `onDelete` behavior |
| `checks` | `ConstraintDefinition[]` | SQL check expressions |
| `indexes` | `ConstraintDefinition[]` | Index definitions for query optimization |

## Audit fields

When `hasAuditFields` is enabled, pg-schemata automatically adds four columns to your schema:

- `created_at` — `timestamptz`, defaults to `NOW()`
- `updated_at` — `timestamptz`, defaults to `NOW()`
- `created_by` — user identifier, set on insert
- `updated_by` — user identifier, set on update

### Boolean format (simple)

```js
hasAuditFields: true
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
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', notNull: true, immutable: true, colProps: { cnd: true } },
    { name: 'tenant_id', type: 'uuid', notNull: true, colProps: { skip: c => !c.exists } },
    { name: 'email', type: 'varchar(255)', notNull: true, colProps: { skip: c => !c.exists } },
    { name: 'first_name', type: 'varchar(100)', colProps: { skip: c => !c.exists } },
    { name: 'last_name', type: 'varchar(100)', colProps: { skip: c => !c.exists } },
    { name: 'address', type: 'jsonb', colProps: { mod: ':json', skip: c => !c.exists } },
    { name: 'is_active', type: 'boolean', default: 'true', notNull: true, colProps: { skip: c => !c.exists } },
    { name: 'role', type: 'varchar(50)', default: "'user'", notNull: true, colProps: { skip: c => !c.exists } },
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
      { type: 'Check', expression: "char_length(email) > 3" },
      { type: 'Check', expression: "role IN ('user', 'admin', 'moderator')" },
    ],
    indexes: [
      { type: 'Index', columns: ['email'] },
      { type: 'Index', columns: ['tenant_id', 'role'] },
    ],
  },
};
```
