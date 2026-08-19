# createDb / Database

Factory for independently owned database handles. One Node process can hold as
many as it needs — an admin database plus one or more cell databases, for
example — and nothing is shared between them.

**Import:**

```js
import { createDb } from 'pg-schemata';
```

Each instance owns its own pg-promise root, connection pool, repository
registry, logger, audit actor resolver, schema cache, migration target, and
lifecycle. An operation performed through one instance never touches another
instance's pool, models, schema state, or migration configuration.

**Routing and secrets are yours.** pg-schemata does not discover cells, map
tenants to databases, or store credentials. Your application decides which
handle to use and where connection details come from.

## createDb(config)

| Option                                                     | Type                   | Description                                                          |
| ---------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `connection`                                               | `string \| object`     | A pg-promise connection string or parameters object                  |
| `connectionString`                                         | `string`               | A PostgreSQL connection string                                       |
| `host` / `port` / `database` / `user` / `password` / `ssl` | various                | Discrete connection fields                                           |
| `pool`                                                     | `object`               | `{ max?, idleTimeoutMillis?, connectionTimeoutMillis? }`             |
| `repositories`                                             | `Record<string, Ctor>` | Repository constructors attached to this instance only               |
| `logger`                                                   | `object \| null`       | Logger passed to every repository this instance builds               |
| `auditActorResolver`                                       | `() => string \| null` | Audit actor resolver scoped to this instance                         |
| `capSQL`                                                   | `boolean`              | Capitalize generated SQL (default `true`)                            |
| `context`                                                  | `unknown`              | pg-promise database context; defaults to a unique per-instance value |

**Returns:** `Database<R>`, where `R` is inferred from `repositories`.

Exactly **one** connection source is allowed: `connection`, `connectionString`,
or the discrete fields. Combining them throws a `TypeError`, as does supplying
none — `pool` on its own is not a connection source. A connection object you
pass is cloned before pool options are merged in, so your object is never
modified; explicit `pool` values win over pool keys inside it.

### Single database

```js
import { createDb } from 'pg-schemata';
import { Users } from './models/Users.js';

const appDb = createDb({
  connectionString: process.env.DATABASE_URL,
  repositories: { users: Users },
  pool: { max: 10 },
});

await appDb.connect();
const user = await appDb.db.users.findById(id);
```

### Admin plus cell

```js
import { createDb } from 'pg-schemata';
import { Tenants } from './models/Tenants.js';
import { Orders } from './models/Orders.js';

const adminDb = createDb({
  connectionString: process.env.ADMIN_DATABASE_URL,
  repositories: { tenants: Tenants },
});

const cellDb = createDb({
  connectionString: process.env.CELL_DATABASE_URL,
  repositories: { orders: Orders },
});

await Promise.all([adminDb.connect(), cellDb.connect()]);

// Your application chooses the handle — pg-schemata does not route.
const tenant = await adminDb.db.tenants.findById(tenantId);
const orders = await cellDb.db.orders.findAll({ limit: 20 });
```

In TypeScript, repository types are inferred per call: `adminDb.db.tenants` and
`cellDb.db.orders` are typed independently, and referencing one instance's
repository on the other is a compile error.

## Instance members

| Member                                                  | Description                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `db`                                                    | This instance's pg-promise database object, with its repositories |
| `pgp`                                                   | This instance's pg-promise root                                   |
| `info` / `toJSON()`                                     | Sanitized connection metadata (see below)                         |
| `isClosed`                                              | `true` once `close()` has been called                             |
| `connect()`                                             | Verifies connectivity; idempotent                                 |
| `close()`                                               | Ends this instance's pool; idempotent                             |
| `query` / `none` / `one` / `oneOrNone` / `any` / `many` | Query helpers on this instance                                    |
| `transaction(work)` / `tx(work)`                        | Runs work in a transaction on this instance                       |
| `task(work)`                                            | Runs work on one pooled connection                                |
| `forSchema(name)`                                       | This instance's repositories bound to a PostgreSQL schema         |
| `migrationManager(options?)`                            | A `MigrationManager` locked to this instance                      |
| `migrate(options?)`                                     | Applies pending migrations to this instance                       |
| `bootstrap(options)`                                    | Creates tables through this instance                              |

## Lifecycle

```js
await appDb.connect(); // safe to call repeatedly
// ... application runs ...
await appDb.close(); // safe to call repeatedly, and concurrently
```

- `connect()` memoizes concurrent calls, so the pool is checked once. A failed
  attempt is **not** memoized — you can retry.
- `close()` ends only this instance's pool (`db.$pool.end()`). Concurrent and
  repeated calls share one shutdown, and the instance is logically closed even
  if ending the pool fails.
- After `close()`, the instance methods throw
  `DatabaseError('Database instance has been closed')`. The raw `instance.db`
  handle and any repository reference you captured earlier bypass that guard and
  produce pg-promise's own "connection pool ... destroyed" error instead.

::: danger Never use pgp.end() to shut down one handle
`pgp.end()` destroys **every** pg-promise pool in the process, including handles
owned by other instances. Always call `instance.close()`.
:::

pg-promise keeps closed database objects in process-global bookkeeping until
process-wide shutdown, so database handles should be long-lived. Do not create
one per request.

## Connection metadata and secrets

`info` (and `toJSON()`) expose only what was configured, and are deep-frozen:

```js
appDb.info;
// { host: 'db.example', port: 5432, database: 'app', user: 'app',
//   ssl: true, pool: { max: 10 } }
```

Passwords and connection strings are never copied into `info`, and values that
would require parsing a connection string are absent rather than guessed. This
is not a claim that credentials are unreachable: the public `instance.db.$cn`
still holds whatever pg-promise was given. The guarantee is narrower — the
factory does not duplicate secrets into its public metadata or serialization.

## forSchema(name)

Returns this instance's repositories bound to an ordinary PostgreSQL schema,
plus `db`, `pgp`, and `schema`:

```js
const tenantA = appDb.forSchema('tenant_a');
await tenantA.users.findAll({ limit: 10 });
```

This selects a PostgreSQL schema and nothing more. It is not tenant routing, and
it never touches `search_path` or pooled session state. Results are cached per
schema name in a bounded LRU, and the cache is cleared on `close()`.

`callDb()` can be pointed at an instance the same way:

```js
import { callDb } from 'pg-schemata';

const users = callDb('users', 'tenant_a', appDb);
```

## Migrations

```js
const result = await cellDb.migrate({
  schema: 'public',
  dir: './migrations',
});
console.log(`Applied ${result.applied.length} migration(s)`);
```

`migrate()` and `migrationManager()` always target the instance they were called
on: `db`, `pgp`, and `auditActorResolver` are not accepted as options, so a
migration cannot be pointed at another database by accident. Pass `dryRun: true`
to preview without executing.

`bootstrap()` works the same way — it always opens its transaction through the
owning instance, and takes no `db`, `owner`, or `pgp` option.

## Audit actor

A resolver passed to `createDb()` is scoped to that instance: it is applied to
every model the instance builds, including the models constructed inside its
migrations and bootstrap. Factory instances never read the process-wide
`setAuditActorResolver()` value, so an actor configured for one database cannot
leak into another.

## Relationship to `DB`

[`DB`](./db.md) remains the compatibility default instance for single-database
applications; internally it holds one `Database` built by `createDb()`.
