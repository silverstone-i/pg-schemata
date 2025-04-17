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

class DB {
  /**
   * @type {import('pg-promise').IDatabase<unknown>}
   * The pg-promise database instance, created on first init.
   */
  static db;

  /**
   * @type {import('pg-promise').IMain}
   * The pg-promise root library instance, initialized with custom options.
   */
  static pgp;

  static init(connection, repositories) {
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

    return DB;
  }
}

/**
 * Initializes the DB singleton with the given connection and repository classes.
 * @param {string|Object} connection - Connection string or config object accepted by pg-promise.
 * @param {Object.<string, new(import('pg-promise').IDatabase<unknown>, import('pg-promise').IMain): any>} repositories
 *   - A mapping of repository names to their classes. Each will be instantiated and attached to the db.
 * @returns {typeof DB} The DB class with `db` and `pgp` initialized.
 */

export const db = DB.db;
export const pgp = DB.pgp;
export default DB;

// Export the singleton instances for use throughout the application
