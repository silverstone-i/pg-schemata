# Error Handling

pg-schemata provides two custom error classes that wrap PostgreSQL and schema validation errors.

## DatabaseError

Thrown when a PostgreSQL query fails. Wraps the original pg-promise/pg error with structured metadata.

```js
import { DatabaseError } from 'pg-schemata';

try {
  await db().users.insert({ email: 'duplicate@example.com' });
} catch (err) {
  if (err instanceof DatabaseError) {
    console.log(err.message);    // 'Unique constraint violation'
    console.log(err.code);       // '23505'
    console.log(err.constraint); // 'users_email_key'
    console.log(err.table);      // 'users'
    console.log(err.detail);     // 'Key (email)=(duplicate@example.com) already exists.'
  }
}
```

### Properties

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable description |
| `name` | `string` | Always `'DatabaseError'` |
| `code` | `string` | PostgreSQL SQLSTATE error code |
| `detail` | `string` | Detailed error message from PostgreSQL |
| `constraint` | `string` | Name of the violated constraint |
| `table` | `string` | Table where the error occurred |
| `original` | `Error` | The original PostgreSQL error object |

### SQLSTATE code mapping

pg-schemata translates common PostgreSQL error codes into descriptive messages:

| Code | Message |
|---|---|
| `23505` | Unique constraint violation |
| `23503` | Foreign key constraint violation |
| `23514` | Check constraint violation |
| `22P02` | Invalid input syntax for type |
| Other | Database operation failed |

## SchemaDefinitionError

Thrown when schema validation or DTO validation fails. This includes invalid schemas, failed Zod validation, and invalid input to model methods.

```js
import { SchemaDefinitionError } from 'pg-schemata';

try {
  await db().users.insert({ invalid_column: 'value' });
} catch (err) {
  if (err instanceof SchemaDefinitionError) {
    console.log(err.message);  // 'DTO must contain at least one valid column'
    console.log(err.cause);    // Zod error details (if validation failed)
  }
}
```

### Properties

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Description of the schema or validation issue |
| `name` | `string` | Always `'SchemaDefinitionError'` |
| `original` | `Error \| null` | Optional original error |
| `cause` | `ZodError \| Error` | Zod validation details (when validation fails) |

## Handling errors in application code

```js
import { DatabaseError, SchemaDefinitionError } from 'pg-schemata';

async function createUser(dto) {
  try {
    return await db().users.insert(dto);
  } catch (err) {
    if (err instanceof SchemaDefinitionError) {
      // Input validation failed — return 400
      return { status: 400, error: err.message, details: err.cause };
    }
    if (err instanceof DatabaseError) {
      if (err.code === '23505') {
        // Duplicate — return 409
        return { status: 409, error: 'User already exists' };
      }
      // Other DB error — return 500
      return { status: 500, error: 'Database error' };
    }
    throw err; // unexpected error
  }
}
```

## Logger integration

Both model classes accept an optional `logger` parameter. When provided, all database errors are logged with structured context:

```js
class Users extends TableModel {
  constructor(db, pgp) {
    super(db, pgp, usersSchema, console); // or your custom logger
  }
}
```

Error logs include the schema name, table name, error message, code, detail, and stack trace.
