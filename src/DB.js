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

  static init(connection, repositories) {
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
              obj[repository] = new repositories[repository](obj, DB.pgp);
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

export const db = DB.db;
export const pgp = DB.pgp;
export default DB;

// Export the singleton instances for use throughout the application
