/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import pgPromise from 'pg-promise';
import type { IDatabase, IInitOptions, IMain } from 'pg-promise';
import type { IConnectionParameters } from 'pg-promise/typescript/pg-subset.js';
import { setAuditActorResolver } from './auditActorResolver.js';
import type {
  AuditActorResolver,
  Logger,
  Repositories,
  RepositoryCtor,
} from './schemaTypes.js';

/**
 * A pg-promise-compatible connection string or configuration object.
 */
export type ConnectionInput = string | IConnectionParameters;

/**
 * The initialized database instance with all registered repositories
 * attached. Augment {@link Repositories} to type your own repositories.
 */
export type ExtendedDb = IDatabase<Repositories> & Repositories;

/**
 * Map of repository names to their constructors, as passed to `DB.init`.
 * When {@link Repositories} is augmented, the keys and instance types are
 * checked against the declared registry.
 */
export type RepositoryMap =
  | { [K in keyof Repositories]: RepositoryCtor<Repositories[K]> }
  | Record<string, RepositoryCtor>;

/** Optional configuration accepted by `DB.init`. */
export interface DbInitOptions {
  /** Callback returning the current actor ID for audit fields. */
  auditActorResolver?: AuditActorResolver;
}

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
   * The initialized pg-promise database instance. Unset until `DB.init`
   * has been called — the singleton contract requires init at startup.
   */
  static db: ExtendedDb;

  /**
   * The pg-promise root library instance. Unset until `DB.init` has been
   * called.
   */
  static pgp: IMain;

  /**
   * Initializes the DB singleton if it hasn't been initialized yet.
   *
   * @param connection - A pg-promise-compatible connection object or string.
   * @param repositories - A map of repository names to their constructors.
   * @param logger - Optional logger passed to each repository.
   * @param options - Optional configuration.
   * @returns The initialized DB class (for chaining or access).
   * @throws {Error} If connection or repositories are invalid.
   */
  static init(
    connection: ConnectionInput,
    repositories: RepositoryMap,
    logger: Logger | null = null,
    options: DbInitOptions = {}
  ): typeof DB {
    if (!DB.db) {
      // Only initialize once to enforce singleton pattern

      if (connection === undefined || connection === null) {
        throw new Error('DB.init requires a connection configuration');
      }

      if (
        !repositories ||
        typeof repositories !== 'object' ||
        Array.isArray(repositories)
      ) {
        throw new Error('DB.init requires a repositories map');
      }

      // Configure pg-promise: capitalize SQL and auto-extend DB with repositories
      const initOptions: IInitOptions<Repositories> = {
        capSQL: true, // capitalize all generated SQL
        extend(obj: ExtendedDb) {
          // Attach each repository to the database instance
          for (const [name, RepoClass] of Object.entries(
            repositories as Record<string, RepositoryCtor>
          )) {
            if (typeof RepoClass !== 'function') {
              throw new TypeError(
                `Repository "${name}" is not a valid constructor`
              );
            }
            (obj as unknown as Record<string, unknown>)[name] = new RepoClass(
              obj,
              DB.pgp,
              logger
            );
          }
        },
      };
      // Initialize the pg-promise library with the custom options
      DB.pgp = pgPromise(initOptions);
      // Create the database instance using the provided connection
      DB.db = DB.pgp<Repositories>(connection);

      // Register audit actor resolver if provided
      if (options.auditActorResolver) {
        setAuditActorResolver(options.auditActorResolver);
      }
    }

    return DB;
  }
}

/** The initialized pg-promise instance. */
export const pgp = (): IMain => DB.pgp;
export const db = (): ExtendedDb => DB.db;

// Named exports for structured access
export { DB };

// Default export for convenience
export default DB;
