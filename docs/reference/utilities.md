# Utilities

Standalone functions exported from pg-schemata.

## callDb(modelOrName, schemaName)

Returns a model bound to a specific PostgreSQL schema. Useful for multi-tenant applications.

**Import:**

```js
import { callDb } from 'pg-schemata';
```

| Parameter     | Type               | Description                                                                  |
| ------------- | ------------------ | ---------------------------------------------------------------------------- |
| `modelOrName` | `string \| object` | Repository name (as registered in `DB.init` or `createDb`) or model instance |
| `schemaName`  | `string`           | PostgreSQL schema to bind                                                    |

**Returns:** The model instance with the schema set

**Throws:** `Error` if the model is not schema-aware

```js
// By name
const tenantUsers = callDb('users', 'tenant_abc');

// By instance
const tenantUsers = callDb(db().users, 'tenant_abc');

// Resolve a name against a specific instance instead of the DB singleton.
// This routes through appDb.forSchema(), so the instance's schema cache and
// closed-state guard both apply.
const scoped = callDb('users', 'tenant_abc', appDb);
```

## bootstrap(options)

Creates all tables defined by the provided models in a single transaction.

**Import:**

```js
import { bootstrap } from 'pg-schemata';
```

| Option       | Type                       | Default    | Description                                              |
| ------------ | -------------------------- | ---------- | -------------------------------------------------------- |
| `models`     | `Record<string, Function>` | —          | Map of repository names to model constructors (required) |
| `schema`     | `string`                   | `'public'` | Target PostgreSQL schema                                 |
| `extensions` | `string[]`                 | `[]`       | PostgreSQL extensions to enable                          |
| `db`         | `ITask`                    | `null`     | Transaction to use (avoids nested transactions)          |

**Returns:** `Promise<void>`

**Throws:** `TypeError` if `models` is not an object

```js
import { bootstrap } from 'pg-schemata';

await bootstrap({
  models: { users: Users, products: Products },
  schema: 'public',
});
```

No extensions are enabled by default. UUID primary keys use the core
`gen_random_uuid()` (PostgreSQL 13+), so pass `extensions` only for extensions
your own schemas actually need:

```js
await bootstrap({ models, schema: 'public', extensions: ['postgis'] });
```

When called from inside a migration, pass the transaction as `db`:

```js
export async function up({ db, schema }) {
  await bootstrap({ models: { users: Users }, schema, db });
}
```

## Audit Actor Resolver

Three functions for managing the module-level audit actor callback.

**Import:**

```js
import {
  setAuditActorResolver,
  clearAuditActorResolver,
  getAuditActor,
} from 'pg-schemata';
```

### setAuditActorResolver(fn)

Registers a synchronous callback that returns the current actor ID.

| Parameter | Type                   | Description                         |
| --------- | ---------------------- | ----------------------------------- |
| `fn`      | `() => string \| null` | Function returning actor ID or null |

**Throws:** `TypeError` if `fn` is not a function

```js
setAuditActorResolver(() => asyncLocalStorage.getStore()?.userId ?? null);
```

### clearAuditActorResolver()

Removes the registered resolver. Primarily useful in tests.

```js
afterEach(() => {
  clearAuditActorResolver();
});
```

### getAuditActor()

Invokes the registered resolver and returns the result, or `null` if no resolver is set.

**Returns:** `string | null`
