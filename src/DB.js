'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import pgPromise from 'pg-promise';

/**
 * DB is a singleton utility class that initializes and provides access
 * to a configured pg-promise database instance. It also auto-attaches
 * custom repositories to the DB object on first initialization.
 *
 * Use `DB.init(connection, repositories)` once at startup to initialize the DB.
 * Then access `DB.db` and `DB.pgp` as needed throughout your application.
 */
class DB {
  /**
   * @private
   * @type {import('pg-promise').IDatabase<any>}
   * The initialized pg-promise database instance.
   */
  static db;

  /**
   * @private
   * @type {import('pg-promise').IMain}
   * The pg-promise root library instance.
   */
  static pgp;

  /**
   * Initializes the DB singleton if it hasn't been initialized yet.
   *
   * @param {object|string} connection - A pg-promise-compatible connection object or string.
   * @param {Object<string, Function>} repositories - A map of repository names to their constructors.
   * @param {object} [logger=null] - Optional logger passed to each repository.
   * @returns {typeof DB} The initialized DB class (for chaining or access).
   * @throws {Error} If connection or repositories are invalid.
   */
  static init(connection, repositories, logger = null) {
    if (!DB.db) {
      // Only initialize once to enforce singleton pattern
      try {
        // Validate that a connection configuration is provided
        if (connection === undefined || connection === null) {
          throw new Error();
        }

        // Validate that a repositories object is provided
        if (!repositories || typeof repositories !== 'object' || Array.isArray(repositories) || repositories === null) {
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
                throw new TypeError(`Repository "${repository}" is not a valid constructor`);
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

/** The initialized pg-promise instance. */
export const pgp = DB.pgp;
/** The initialized pg-promise database instance. */
export const db = DB.db;

// Named exports for structured access
export { DB };

// Default export for convenience
export default DB;
