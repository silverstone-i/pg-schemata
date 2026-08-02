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
    extensions: ['pgcrypto'],
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
