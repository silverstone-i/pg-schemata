'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

// migrations/0001_bootstrap.mjs
//
// Example initial migration. This migration creates all tables defined in
// your repository map (the models you pass into DB.init()). It should be
// run on an empty database to bootstrap your application schema.

import { bootstrap } from '../src/migrate/bootstrap.js';

// Adjust this import to point at your model definitions. Typically you
// would import an index that exports all of your model classes. For
// example:
//   import * as models from '../src/models/index.js';
// Here we leave the models object empty because it will be supplied via
// DB.init() in your application code. See the README_PR.md instructions
// for more details.

export async function up({ db, schema }) {
  // When running via MigrationManager, `db` is a pg‑promise transaction
  // object scoped to the same connection as the transaction. We don't
  // initialize DB here because it's already initialized in your
  // application setup.

  // If you need to create your tables here, import your models map and
  // call bootstrap({ models, schema }). Example:
  // const models = { User: User, Project: Project, ... };
  // await bootstrap({ models, schema });

  // For demonstration purposes, this migration does nothing. Replace
  // the contents of up() with your own bootstrap logic.
  return;
}