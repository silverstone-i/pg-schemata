# Audit Fields

pg-schemata can automatically track who created and modified records and when, by adding audit columns to your table.

## Enabling audit fields

### Boolean format

```js
const schema = {
  // ...
  hasAuditFields: true,
};
```

Adds four columns:

- `created_at` — `timestamptz`, defaults to `NOW()`
- `updated_at` — `timestamptz`, defaults to `NOW()`
- `created_by` — `varchar(50)`, defaults to `'system'`
- `updated_by` — `varchar(50)`, nullable

### Object format

For control over the user field types:

```js
const schema = {
  // ...
  hasAuditFields: {
    enabled: true,
    userFields: {
      type: 'uuid', // PostgreSQL type for created_by / updated_by
      nullable: true, // allow null
      default: null, // default value (instead of 'system')
    },
  },
};
```

## Automatic population

When audit fields are enabled:

- **On insert**: `created_by` is set from the audit actor resolver (or the schema default)
- **On update**: `updated_at` and `updated_by` are both set
- **On soft delete** (`removeWhere`): `updated_by` and `updated_at` are updated
- **On restore** (`restoreWhere`): `updated_by` and `updated_at` are updated

### Timestamps do not depend on the resolver

`updated_at` records _when_ a row changed and is written on every update path
whether or not an actor resolves. `updated_by` records _who_, so it is written
only when the resolver returns one — with no resolver configured, the column
keeps whatever actor was last recorded rather than being overwritten with null.

That means `touch()` works without a resolver: the timestamp still advances.

### What you can and cannot pass

You don't need to pass any of these in your DTOs. Two behave differently if you
do:

| Column       | Value in your DTO                                                                 |
| ------------ | --------------------------------------------------------------------------------- |
| `updated_at` | **Discarded.** The library owns this column and always writes `CURRENT_TIMESTAMP` |
| `updated_by` | **Honored.** An explicit value wins over the resolver                             |

To preserve original timestamps during a data import, write those rows with
`updateWhere()` or raw SQL rather than `update()`.

## Audit actor resolver

The audit actor resolver is a callback function that returns the current user's identifier. This is how pg-schemata knows _who_ is performing the operation.

### Setting the resolver

Register a resolver at application startup:

```js
import { setAuditActorResolver } from 'pg-schemata';

setAuditActorResolver(() => {
  // Return the current user ID from your app context
  // For example, from AsyncLocalStorage:
  return asyncLocalStorage.getStore()?.userId ?? null;
});
```

The resolver must be a synchronous function that returns a `string` or `null`.

### Via DB.init options

You can also pass the resolver as an option to `DB.init()`:

```js
DB.init(connectionString, repositories, null, {
  auditActorResolver: () => asyncLocalStorage.getStore()?.userId ?? null,
});
```

### Resolution priority

When pg-schemata needs the current actor:

1. Calls the registered `auditActorResolver` callback
2. If the resolver returns `null` (or none is registered), falls back to the schema's default:
   - Boolean `hasAuditFields: true` → `'system'`
   - Object format → the `userFields.default` value (or `null`)

### Express middleware example

```js
import { AsyncLocalStorage } from 'node:async_hooks';
import { setAuditActorResolver } from 'pg-schemata';

const als = new AsyncLocalStorage();

// Register the resolver once at startup
setAuditActorResolver(() => als.getStore()?.userId ?? null);

// Middleware to set the current user
app.use((req, res, next) => {
  const userId = req.user?.id ?? null;
  als.run({ userId }, next);
});

// Now all database operations in this request automatically
// get the correct created_by / updated_by value
app.post('/api/users', async (req, res) => {
  const user = await db().users.insert(req.body);
  // user.created_by === req.user.id
  res.json(user);
});
```

### Clearing the resolver

Use `clearAuditActorResolver()` to remove the registered resolver. This is primarily useful in tests:

```js
import { clearAuditActorResolver } from 'pg-schemata';

afterEach(() => {
  clearAuditActorResolver();
});
```
