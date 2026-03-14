# Models

pg-schemata provides two model classes that implement the repository pattern on top of pg-promise.

## QueryModel — read-only access

`QueryModel` provides read-only query methods. Use it when a model should not be allowed to write data.

```js
import { QueryModel } from 'pg-schemata';

class UsersReadOnly extends QueryModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, usersSchema, logger);
  }
}
```

Key methods: `findAll`, `findById`, `findWhere`, `findOneBy`, `findAfterCursor`, `count`, `countAll`, `exists`, `exportToSpreadsheet`.

## TableModel — full CRUD

`TableModel` extends `QueryModel` and adds write operations. This is the standard entry point for interacting with a table.

```js
import { TableModel } from 'pg-schemata';

class Users extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, usersSchema, logger);
  }
}
```

`TableModel` requires that your schema defines a `primaryKey` in `constraints`. It adds: `insert`, `update`, `delete`, `upsert`, `bulkInsert`, `bulkUpdate`, `bulkUpsert`, `deleteWhere`, `updateWhere`, `removeWhere`, `restoreWhere`, `importFromSpreadsheet`, `createTable`, `truncate`.

## Constructor parameters

Both models receive three required parameters from pg-promise's `extend` event:

| Parameter | Type | Description |
|---|---|---|
| `db` | `IDatabase` | The pg-promise database or transaction instance |
| `pgp` | `IMain` | The pg-promise library instance |
| `schema` | `TableSchema` | Your schema definition object |
| `logger` | `object` | Optional logger (must have `.error()`, `.info()` methods) |

## The repository pattern

Models are registered as repositories during `DB.init()`. pg-promise's `extend` event instantiates each model and attaches it to the database object:

```js
import { DB, db } from 'pg-schemata';
import { Users } from './models/Users.js';
import { Products } from './models/Products.js';

const repositories = {
  users: Users,
  products: Products,
};

DB.init(process.env.DATABASE_URL, repositories);

// Access repositories via db()
const database = db();
const user = await database.users.findById(id);
const items = await database.products.findAll();
```

## Adding custom methods

Extend `TableModel` with domain-specific methods that compose the built-in query primitives:

```js
class Users extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, usersSchema, logger);
  }

  async findByEmail(email) {
    return this.findOneBy([{ email }]);
  }

  async findActiveByTenant(tenantId) {
    return this.findWhere(
      [{ tenant_id: tenantId, is_active: true }],
      'AND',
      { orderBy: 'email' }
    );
  }

  async deactivateUser(id) {
    return this.removeWhere({ id });
  }
}
```

## Schema access

Every model instance exposes its schema and table identifiers:

```js
const model = database.users;

model.schema;      // the full schema definition object
model.schemaName;  // escaped PostgreSQL schema name (e.g. "public")
model.tableName;   // escaped table name (e.g. "users")
```

## Switching schemas at runtime

Use `setSchemaName()` to change the PostgreSQL schema a model operates on:

```js
model.setSchemaName('tenant_abc');
const rows = await model.findAll();  // queries tenant_abc.users
```

See [Multi-Schema](/guide/multi-schema) for the full multi-tenancy pattern.
