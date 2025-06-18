'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

/**
 * DB is a singleton that initializes and provides access to the pg-promise
 * database instance and attaches repository classes for your application.
 */

import pgPromise from 'pg-promise';

/**
 * Initializes the DB singleton with the given connection and repository classes.
 *
 * @param {string|Object} connection - Connection string or configuration object for pg-promise.
 * @param {Object} repositories - An object mapping repository names to constructor functions.
 *                                Each constructor must accept a db instance and a pgp instance.
 * @returns {DB} The DB class with `db` and `pgp` initialized.
 */
class DB {
  /**
   * The pg-promise database instance, created on first init.
   * This is set during the first call to DB.init and remains the same thereafter.
   */
  static db;

  /**
   * The pg-promise root library instance, initialized with custom options.
   * Used to configure database helpers and attach repositories.
   */
  static pgp;

  static init(connection, repositories, logger = null) {
    if (!DB.db) {
      // Only initialize once to enforce singleton pattern
      try {
        // Validate that a connection configuration is provided
        if (connection === undefined || connection === null) {
          throw new Error();
        }

        // Validate that a repositories object is provided
        if (
          !repositories ||
          typeof repositories !== 'object' ||
          Array.isArray(repositories) ||
          repositories === null
        ) {
          throw new Error();
        }

        // Configure pg-promise: capitalize SQL and auto-extend DB with repositories
        const initOptions = {
          capSQL: true, // capitalize all generated SQL
          extend(obj, dc) {
            // Attach each repository to the database instance
            for (const repository of Object.keys(repositories)) {
              const RepoClass = repositories[repository];
              if (typeof RepoClass !== 'function') {
                throw new TypeError(
                  `Repository "${repository}" is not a valid constructor`
                );
              }
              obj[repository] = new RepoClass(obj, DB.pgp, logger);
            }
          },
        };
        // Initialize the pg-promise library with the custom options
        DB.pgp = pgPromise(initOptions);
        // Create the database instance using the provided connection
        DB.db = DB.pgp(connection);

      } catch (error) {
        throw error;
      }
    }

    return DB;
  }
}

function callDb(modelOrName, schemaName) {
  const model =
    typeof modelOrName === 'string' ? DB.db[modelOrName] : modelOrName;

  if (!model || typeof model.setSchemaName !== 'function') {
    throw new Error('callDb: provided model is not schema-aware');
  }

  return model.setSchemaName(schemaName);
}

// Export initialized pgp and db for advanced usage
export const pgp = DB.pgp;
export const db = DB.db;

// Named exports for structured access
export { DB, callDb };

// Default export for convenience
export default DB;
