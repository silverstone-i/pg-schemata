# Schema Types

Type definitions for the schema objects used throughout pg-schemata. These interfaces are defined in `src/schemaTypes.d.ts` and provide IntelliSense in editors.

## TableSchema

The top-level schema definition object.

```ts
interface TableSchema {
  dbSchema: string;
  table: string;
  hasAuditFields?: boolean | AuditFieldsConfig;
  softDelete?: boolean;
  version?: string;
  columns: ColumnDefinition[];
  constraints?: Constraints;
}
```

| Property | Type | Required | Description |
|---|---|---|---|
| `dbSchema` | `string` | Yes | PostgreSQL schema name (e.g. `'public'`) |
| `table` | `string` | Yes | Table name |
| `columns` | `ColumnDefinition[]` | Yes | Array of column definitions |
| `constraints` | `Constraints` | No | Table-level constraints |
| `hasAuditFields` | `boolean \| AuditFieldsConfig` | No | Enable audit tracking columns |
| `softDelete` | `boolean` | No | Enable soft delete via `deactivated_at` |
| `version` | `string` | No | Schema version string |

## ColumnDefinition

Defines the structure of a single column.

```ts
interface ColumnDefinition {
  name: string;
  type: string;
  generated?: 'always' | 'by default';
  expression?: string;
  stored?: boolean;
  notNull?: boolean;
  default?: any;
  immutable?: boolean;
  colProps?: {
    mod?: string;
    skip?: (col: any) => boolean;
    cnd?: boolean;
    init?: (dto: any) => any;
    def?: string;
    validator?: any;
  };
}
```

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Column name |
| `type` | `string` | PostgreSQL data type |
| `generated` | `'always' \| 'by default'` | Generated column mode |
| `expression` | `string` | SQL expression for generated columns |
| `stored` | `boolean` | Whether generated column is stored |
| `notNull` | `boolean` | Reject null values |
| `default` | `any` | Default value (SQL expression as string) |
| `immutable` | `boolean` | Exclude from update operations |
| `colProps` | `object` | pg-promise column behavior modifiers |

### colProps detail

| Property | Type | Description |
|---|---|---|
| `mod` | `string` | pg-promise format modifier (e.g. `':json'`) |
| `skip` | `(col) => boolean` | Skip column conditionally |
| `cnd` | `boolean` | Use in conditional update clause |
| `init` | `(dto) => any` | Compute value dynamically |
| `def` | `string` | Override default value in ColumnSet |
| `validator` | `ZodSchema` | Custom Zod validator for this column |

## Constraints

Container for all table-level constraints.

```ts
interface Constraints {
  primaryKey?: string[];
  unique?: (string[] | UniqueConstraintDefinition)[];
  foreignKeys?: ConstraintDefinition[];
  checks?: ConstraintDefinition[];
  indexes?: ConstraintDefinition[];
}
```

## ConstraintDefinition

A single constraint definition.

```ts
interface ConstraintDefinition {
  type: 'PrimaryKey' | 'ForeignKey' | 'Unique' | 'Check' | 'Index';
  columns: string[];
  references?: { table: string; columns: string[] };
  onDelete?: string;
  expression?: string;
}
```

## UniqueConstraintDefinition

Unique constraint with optional PostgreSQL 15+ modifiers.

```ts
interface UniqueConstraintDefinition {
  columns: string[];
  nullsNotDistinct?: boolean;
  name?: string;
}
```

| Property | Type | Description |
|---|---|---|
| `columns` | `string[]` | Column names for the unique constraint |
| `nullsNotDistinct` | `boolean` | Treat NULLs as equal for uniqueness (PostgreSQL 15+) |
| `name` | `string` | Custom constraint name (auto-generated if omitted) |

## AuditFieldsConfig

Configuration for audit fields in object format.

```ts
interface AuditFieldsConfig {
  enabled: boolean;
  userFields?: {
    type?: string;
    nullable?: boolean;
    default?: any;
  };
}
```

| Property | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | — | Whether to include audit fields |
| `userFields.type` | `string` | `'varchar(50)'` | PostgreSQL type for `created_by` / `updated_by` |
| `userFields.nullable` | `boolean` | `true` | Allow null for user fields |
| `userFields.default` | `any` | `null` | Default value for user fields |
