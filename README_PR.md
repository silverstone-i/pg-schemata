# pg‑schemata migration support PR

This pull request introduces first‑class schema versioning and migration
functionality to **pg‑schemata**.  It adds:

* A `SchemaMigrations` model and accompanying `migrationSchema` definition for
  tracking applied migrations.
* A `MigrationManager` class that discovers and applies migration files,
  records their execution, and prevents concurrent runs via advisory locks.
* A `bootstrap` helper to create all tables defined in your models on first
  run.
* Example migration file (`migrations/0001_bootstrap.mjs`) you can use as a
  starting point for your own migrations.

## Installing the PR files

1. **Copy new modules into your project.**

   Place the files from this PR into the corresponding directories in your
   `pg‑schemata` source tree:

   ```
   src/models/SchemaMigrations.js
   src/migrate/MigrationManager.js
   src/migrate/bootstrap.js
   migrations/0001_bootstrap.mjs          # optional example
   ```

   Create the `migrate` directory if it doesn’t exist.  You can place your
   future migration files under `migrations/`.

2. **Expose the new classes.**  Modify `src/index.js` to re‑export the
   migration helpers.  At a minimum, append the following lines at the end
   of the file:

   ```js
   // export migration helpers
   export * from './migrate/MigrationManager.js';
   export * from './migrate/bootstrap.js';
   export * from './models/SchemaMigrations.js';
   ```

3. **(Optional) Initialise your project’s DB schema.**  The example
   migration (`0001_bootstrap.mjs`) shows how to call `bootstrap()` with
   your model map to create all tables.  Replace the placeholder code in
   that file with actual calls to `bootstrap()` using your own models.

## Writing migrations

Migrations live in a directory (by default `migrations/`) and are named
with a numeric prefix followed by a descriptive suffix, e.g.:

```
0001_init.mjs
0002_add_users_table.mjs
0003_alter_projects.mjs
```

Each file must export an asynchronous `up({ db, schema })` function.  The
`db` parameter is a pg‑promise transaction object scoped to your current
connection.  The `schema` parameter is the Postgres schema name (default
`public`).  Inside `up()` you should perform any DDL or data migrations
needed for that version.  For example:

```js
// migrations/0002_add_users_table.mjs
import { TableModel } from '../src/TableModel.js';
import { userSchema } from '../src/schemas/userSchema.js';

export async function up({ db, schema }) {
  const Users = new TableModel(db, db.$config.pgp, userSchema);
  await Users.createTable();
}
```

You can also execute raw SQL, run data migrations, or call the
`bootstrap()` helper to create all tables at once.

## Running migrations

At application startup, after calling `DB.init()`, create a
`MigrationManager` instance and call `applyAll()`:

```js
// init-db.mjs
import { DB } from 'pg-schemata';
import { User } from './models/User.js';
import { Project } from './models/Project.js';

export default async function init() {
  // Initialise the DB with your repositories
  DB.init(process.env.DATABASE_URL, { users: User, projects: Project });
}

// migrate.mjs
import init from './init-db.mjs';
import { MigrationManager } from 'pg-schemata';

await init();
const mm = new MigrationManager({ schema: 'public', dir: './migrations' });
const result = await mm.applyAll();
console.log(`Applied ${result.applied} migrations:`, result.files);
```

Run the migration script with Node (be sure to set `NODE_OPTIONS=--loader
esm-loader` if necessary, depending on your environment):

```sh
node migrate.mjs
```

### End-to-end example

For a full walkthrough that creates three related tables and ships a
follow-up migration, see `Examples/migration-tutorial/README.md`.

The `MigrationManager` will:

1. Ensure that the `schema_migrations` table exists (creating it if
   necessary) using `SchemaMigrations.createTable()`.
2. Determine the current version of the schema for the given Postgres
   schema (based on the `schema_migrations` table).
3. Discover migration files in the specified directory whose numeric
   prefix is greater than the current version.
4. Acquire an advisory lock to prevent concurrent migrations.
5. Execute each pending migration in order within a single transaction.
6. Record each successfully applied migration in the `schema_migrations`
   table.

## Testing the PR

To verify that the migration infrastructure works in your environment:

1. **Create a temporary database** (e.g. `pg-schemata-test`) in your
   PostgreSQL server.
2. Set `DATABASE_URL` to point at this test database.
3. Place one or more migration files in the `migrations/` directory.
4. Execute the migration script as shown above.  The console output
   should indicate the number and names of the migrations applied.
5. Inspect the database to confirm that the tables were created and
   the `schema_migrations` table contains a row for each migration.

Once you are satisfied that the migrations apply cleanly and that your
application starts correctly on the migrated database, you can merge
these changes into your main branch and accept the pull request.
