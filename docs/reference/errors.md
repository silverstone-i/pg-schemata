# Errors

pg-schemata exports two custom error classes for structured error handling.

## DatabaseError

Wraps PostgreSQL errors thrown by pg-promise with structured metadata.

**Import:**

```js
import { DatabaseError } from 'pg-schemata';
// or
import DatabaseError from 'pg-schemata/src/DatabaseError.js';
```

### Constructor

```js
new DatabaseError(message, originalError)
```

| Parameter | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable error description |
| `originalError` | `Error` | The original PostgreSQL error |

### Properties

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Always `'DatabaseError'` |
| `message` | `string` | Human-readable description |
| `code` | `string` | PostgreSQL SQLSTATE error code |
| `detail` | `string` | Detailed error message from PostgreSQL |
| `constraint` | `string` | Name of the violated constraint |
| `table` | `string` | Table where the error occurred |
| `original` | `Error` | The original PostgreSQL error object |

### SQLSTATE mapping

The `handleDbError` method in QueryModel translates common codes:

| Code | Message |
|---|---|
| `23505` | Unique constraint violation |
| `23503` | Foreign key constraint violation |
| `23514` | Check constraint violation |
| `22P02` | Invalid input syntax for type |
| Other | Database operation failed |

## SchemaDefinitionError

Thrown for schema validation failures, invalid DTOs, and Zod validation errors.

**Import:**

```js
import { SchemaDefinitionError } from 'pg-schemata';
// or
import SchemaDefinitionError from 'pg-schemata/src/SchemaDefinitionError.js';
```

### Constructor

```js
new SchemaDefinitionError(message, originalError?)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `message` | `string` | — | Description of the schema or validation issue |
| `originalError` | `Error` | `null` | Optional original error |

### Properties

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Always `'SchemaDefinitionError'` |
| `message` | `string` | Error description |
| `original` | `Error \| null` | Original error (if provided) |
| `cause` | `ZodError \| Error` | Set by model methods when Zod validation fails |

### Common scenarios

| Scenario | Message |
|---|---|
| Missing primary key in schema | `'Primary key must be defined in the schema'` |
| Empty DTO on insert | `'DTO must be a non-empty object'` |
| No valid columns after sanitization | `'DTO must contain at least one valid column'` |
| Zod validation failure | `'DTO validation failed'` (with `.cause` containing details) |
| Invalid WHERE operator | `'Unsupported operator: $invalid'` |
| Empty conflict columns for upsert | `'Conflict columns must be a non-empty array'` |
