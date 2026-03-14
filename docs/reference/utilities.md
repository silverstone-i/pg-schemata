# Utilities

Standalone functions exported from pg-schemata.

## callDb(modelOrName, schemaName)

Returns a model bound to a specific PostgreSQL schema. Useful for multi-tenant applications.

**Import:**

```js
import { callDb } from 'pg-schemata';
```

| Parameter | Type | Description |
|---|---|---|
| `modelOrName` | `string \| object` | Repository name (as registered in `DB.init`) or model instance |
| `schemaName` | `string` | PostgreSQL schema to bind |

**Returns:** The model instance with the schema set

**Throws:** `Error` if the model is not schema-aware

```js
// By name
const tenantUsers = callDb('users', 'tenant_abc');

// By instance
const tenantUsers = callDb(db().users, 'tenant_abc');
```

## bootstrap(options)

Creates all tables defined by the provided models in a single transaction.

**Import:**

```js
import { bootstrap } from 'pg-schemata';
```

| Option | Type | Default | Description |
|---|---|---|---|
| `models` | `Record<string, Function>` | — | Map of repository names to model constructors (required) |
| `schema` | `string` | `'public'` | Target PostgreSQL schema |
| `extensions` | `string[]` | `['pgcrypto']` | PostgreSQL extensions to enable |
| `db` | `ITask` | `null` | Transaction to use (avoids nested transactions) |

**Returns:** `Promise<void>`

**Throws:** `TypeError` if `models` is not an object

```js
import { bootstrap } from 'pg-schemata';

await bootstrap({
  models: { users: Users, products: Products },
  schema: 'public',
  extensions: ['pgcrypto'],
});
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

| Parameter | Type | Description |
|---|---|---|
| `fn` | `() => string \| null` | Function returning actor ID or null |

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
