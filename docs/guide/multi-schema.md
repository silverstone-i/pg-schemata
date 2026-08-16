# Multi-Schema

pg-schemata supports PostgreSQL's schema feature for per-tenant data isolation. Each tenant's data lives in its own PostgreSQL schema, and models can switch schemas at runtime.

## PostgreSQL schemas

A PostgreSQL schema is a namespace within a database. Tables in different schemas can have the same name without conflict. This makes schemas ideal for multi-tenant applications where each tenant gets an isolated set of tables.

## Setting the schema on a model

### forSchema

`forSchema()` returns a model bound to the given schema. The instance you call it on is never modified — each schema gets its own cached clone, so a shared repository is safe under concurrent requests:

```js
const users = db().users;

const abcUsers = users.forSchema('tenant_abc');
const rows = await abcUsers.findAll();
// Queries tenant_abc.users

const xyzUsers = users.forSchema('tenant_xyz');
const rows2 = await xyzUsers.findAll();
// Queries tenant_xyz.users

// users itself is still bound to its original schema
```

It chains naturally:

```js
const rows = await db().users.forSchema('tenant_abc').findAll();
```

Clones are cached per schema, so calling `forSchema()` on every request costs one cache lookup after the first call.

### Schema names are validated

`forSchema()` rejects anything that is not a usable SQL identifier: it must
start with a letter or underscore, contain only letters, digits, underscores and
dollar signs, and fit within PostgreSQL's 63-byte identifier limit. Anything
else throws `SchemaDefinitionError`.

This matters because schema names in a schema-per-tenant deployment are usually
derived from a request — a subdomain, a header, a claim. DDL generation
interpolates the schema name into a SQL string rather than parameterizing it, so
an unvalidated name could close its own quoting and append a second statement
during `bootstrap()` or a migration.

```js
users.forSchema('tenant_abc'); // fine
users.forSchema('tenant-abc'); // throws — hyphen
users.forSchema('a'.repeat(64)); // throws — PostgreSQL would truncate it
```

The same check runs on `dbSchema`, `table`, and every column, constraint and
index name at model construction, so an unusable name fails when the model is
built rather than when DDL is first generated.

::: warning New in 3.0.0
Previously `forSchema()` accepted any non-empty string. If you derive schema
names from user input, validate or map them to a known set on your side too —
this check is a backstop, not an authorization boundary.
:::

::: info Removed in 2.0.0
`setSchemaName()` was removed. It mutated the model instance in place, so two interleaved requests sharing one repository raced on the schema. `forSchema()` is the replacement.
:::

## callDb — schema-aware accessor

`callDb` is a convenience wrapper around `forSchema()` that also accepts a registered model name:

```js
import { callDb } from 'pg-schemata';

// By model name (as registered in repositories)
const tenantUsers = callDb('users', 'tenant_abc');
const rows = await tenantUsers.findAll();

// By model instance
const tenantUsers = callDb(db().users, 'tenant_abc');
```

## Per-request schema switching

In a web application, resolve the tenant schema from the request and use `callDb()`:

```js
app.use((req, res, next) => {
  // Resolve tenant from subdomain, header, JWT, etc.
  req.tenantSchema = resolveTenant(req);
  next();
});

app.get('/api/users', async (req, res) => {
  const users = callDb('users', req.tenantSchema);
  const rows = await users.findAll();
  res.json(rows);
});
```

## Creating tenant schemas

Use `bootstrap()` with the target schema to create all tables in a new tenant schema:

```js
import { bootstrap } from 'pg-schemata';

async function provisionTenant(schemaName) {
  // Create the PostgreSQL schema
  await db().none('CREATE SCHEMA IF NOT EXISTS $1:name', schemaName);

  // Create all tables
  await bootstrap({
    models: repositories,
    schema: schemaName,
  });
}
```

## Migrations per schema

Use `MigrationManager` with the target schema:

```js
import { MigrationManager } from 'pg-schemata';

async function migrateTenant(schemaName) {
  const manager = new MigrationManager({
    schema: schemaName,
    dir: 'migrations',
  });
  return manager.applyAll();
}
```

The advisory lock is scoped per schema, so migrations for different tenants can run concurrently.
