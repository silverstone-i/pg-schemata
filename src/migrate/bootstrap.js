'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

// src/migrate/bootstrap.js
//
// Utility to create all defined tables on first run.
//
// The `bootstrap` function is a convenience wrapper that walks through
// your repository map (as passed to `DB.init()`) and calls the
// `createTable()` method on each TableModel subclass. It can also enable
// PostgreSQL extensions as needed (defaults to pgcrypto for UUID support).
//
// It should be executed before any migrations if your database does not yet
// have the required tables. Use it from within a migration or during initial setup.

import { DB } from '../DB.js';

/**
 * Create all tables defined by the provided models. This runs inside a
 * single transaction to ensure that either all tables are created or
 * none are if an error occurs.
 *
 * @param {object} options Options
 * @param {Object<string, Function>} options.models Map of repository names to their constructors
 * @param {string} [options.schema='public'] Target Postgres schema
 * @param {string[]} [options.extensions=['pgcrypto']] PostgreSQL extensions to enable before creating tables
 * @param {object} [options.db] Optional pg-promise transaction/connection to use (avoids nested transaction deadlock)
 * @returns {Promise<void>}
 */
export async function bootstrap({ models, schema = 'public', extensions = ['pgcrypto'], db = null }) {
  if (!models || typeof models !== 'object') {
    throw new TypeError('models option must be an object mapping names to Model classes');
  }

  async function doBootstrap(t) {
    // Enable PostgreSQL extensions if specified
    if (extensions && Array.isArray(extensions)) {
      for (const extension of extensions) {
        await t.none('CREATE EXTENSION IF NOT EXISTS $1:name', extension);
      }
    }

    for (const key of Object.keys(models)) {
      const ModelClass = models[key];
      // Skip values that are not classes
      if (typeof ModelClass !== 'function') continue;
      const instance = new ModelClass(t, DB.pgp);
      if (schema && typeof instance.setSchemaName === 'function') {
        instance.setSchemaName(schema);
      }
      if (typeof instance.createTable === 'function') {
        await instance.createTable();
      }
    }
  }

  // Use provided transaction or create a new one
  if (db) {
    await doBootstrap(db);
  } else {
    await DB.db.tx(doBootstrap);
  }
}
