# DB

Singleton class that initializes and provides access to a configured pg-promise database instance.

**Import:**

```js
import { DB, db, pgp } from 'pg-schemata';
```

## DB.init(connection, repositories, logger?, options?)

Initializes the database singleton. Call once at application startup.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `connection` | `string \| object` | Yes | pg-promise connection string or config object |
| `repositories` | `Record<string, Function>` | Yes | Map of repository names to model constructors |
| `logger` | `object` | No | Logger instance passed to each repository (default `null`) |
| `options` | `object` | No | Configuration options |
| `options.auditActorResolver` | `() => string \| null` | No | Callback returning the current actor ID for audit fields |

**Returns:** `DB` class (for chaining)

**Throws:** `Error` if `connection` or `repositories` are invalid

```js
import { DB } from 'pg-schemata';
import { Users } from './models/Users.js';

DB.init(process.env.DATABASE_URL, { users: Users });
```

With audit resolver:

```js
DB.init(
  process.env.DATABASE_URL,
  { users: Users },
  console,
  { auditActorResolver: () => als.getStore()?.userId ?? null }
);
```

Calling `init()` multiple times is safe — subsequent calls are no-ops (singleton).

## db()

Returns the initialized pg-promise database instance.

**Returns:** `IDatabase<any>` — the pg-promise database object with attached repositories

```js
import { db } from 'pg-schemata';

const user = await db().users.findById(id);
```

## pgp()

Returns the pg-promise library instance.

**Returns:** `IMain` — the pg-promise root library

```js
import { pgp } from 'pg-schemata';

const formatted = pgp().as.format('WHERE id = $1', [id]);
```
