# DB

Singleton class that initializes and provides access to a configured pg-promise
database instance.

`DB` is the **compatibility default instance**: internally it holds one
[`Database`](./database.md) built by `createDb()`, and republishes its handles on
the static `DB.db` / `DB.pgp` fields. It remains the simplest entry point for a
single-database application.

Applications that need more than one database in a process — an admin database
plus one or more cells — should call [`createDb()`](./database.md) directly
instead. `DB` connects exactly one.

**Import:**

```js
import { DB, db, pgp } from 'pg-schemata';
```

## DB.init(connection, repositories, logger?, options?)

Initializes the database singleton. Call once at application startup.

| Parameter                    | Type                       | Required | Description                                                |
| ---------------------------- | -------------------------- | -------- | ---------------------------------------------------------- |
| `connection`                 | `string \| object`         | Yes      | pg-promise connection string or config object              |
| `repositories`               | `Record<string, Function>` | Yes      | Map of repository names to model constructors              |
| `logger`                     | `object`                   | No       | Logger instance passed to each repository (default `null`) |
| `options`                    | `object`                   | No       | Configuration options                                      |
| `options.auditActorResolver` | `() => string \| null`     | No       | Callback returning the current actor ID for audit fields   |

**Returns:** `DB` class (for chaining)

**Throws:** `Error` if `connection` or `repositories` are invalid

```js
import { DB } from 'pg-schemata';
import { Users } from './models/Users.js';

DB.init(process.env.DATABASE_URL, { users: Users });
```

With audit resolver:

```js
DB.init(process.env.DATABASE_URL, { users: Users }, console, {
  auditActorResolver: () => als.getStore()?.userId ?? null,
});
```

Calling `init()` multiple times is safe — subsequent calls are complete no-ops:
the database is not recreated, and an `auditActorResolver` passed to a later call
is ignored.

## DB.close()

Closes the default instance's pool and resets the singleton so a later
`DB.init()` starts cleanly. It clears `DB.db`, `DB.pgp`, and any audit resolver
registered through `DB.init()`.

**Returns:** `Promise<void>`

```js
await DB.close();
```

Safe before initialization, and safe to call repeatedly or concurrently. Use it
instead of `pgp.end()`, which destroys **every** pg-promise pool in the process —
including handles owned by `createDb()` instances.

`DB.db` and `DB.pgp` remain writable fields in 3.x, so existing code that assigns
them keeps working. Reassignment is discouraged: `DB.close()` is the supported
way to reset the singleton.

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
