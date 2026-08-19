/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/DB.ts
//
// The DB singleton is the compatibility surface for single-database
// applications. Since 3.1 it is a thin adapter over createDb(): DB.init()
// builds one default Database instance and republishes its handles on the
// static fields the published API has always exposed.
//
// New code that needs more than one database should call createDb() directly
// (see src/Database.ts).

import type { IMain } from 'pg-promise';
import { createDb } from './Database.js';
import type { Database } from './Database.js';
import {
  clearAuditActorResolver,
  getAuditActor,
  setAuditActorResolver,
} from './auditActorResolver.js';
import type {
  AuditActorResolver,
  Logger,
  Repositories,
  RepositoryCtor,
} from './schemaTypes.js';

export type { ConnectionInput } from './Database.js';
import type { ConnectionInput } from './Database.js';
import type { IDatabase } from 'pg-promise';

/**
 * The initialized database instance with all registered repositories
 * attached. Augment {@link Repositories} to type your own repositories.
 */
export type ExtendedDb = IDatabase<Repositories> & Repositories;

/**
 * Map of repository names to their constructors, as passed to `DB.init`.
 *
 * When {@link Repositories} is augmented, the keys and instance types are
 * checked against the declared registry: a missing repository, an extra one, or
 * a constructor producing the wrong instance type is a compile error.
 *
 * This was previously a union with `Record<string, RepositoryCtor>`, which
 * accepted any string-keyed map — so the mapped type never constrained
 * anything and the checking the doc promised did not happen. It is now a
 * conditional: the permissive form applies only while `Repositories` is
 * un-augmented, which is how the package ships, so consumers who have not
 * declared their registry compile exactly as before.
 */
export type RepositoryMap = RepositoryMapFor<Repositories>;

/**
 * @private
 *
 * The conditional behind {@link RepositoryMap}, parameterized over the registry
 * so it can be exercised against a fake one. Augmenting {@link Repositories} in
 * a test file would apply globally to the whole compilation unit and break
 * every other suite's `DB.init` call.
 */
export type RepositoryMapFor<R> = keyof R extends never
  ? Record<string, RepositoryCtor>
  : { [K in keyof R]: RepositoryCtor<R[K]> };

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
 *
 * It is the documented **default instance**: internally it holds one
 * {@link Database} built by `createDb()`. Applications that need several
 * databases in one process should call `createDb()` directly instead of
 * reaching for this class.
 */
class DB {
  /**
   * The initialized pg-promise database instance. Unset until `DB.init`
   * has been called — the singleton contract requires init at startup.
   *
   * Reassigning this field is discouraged; use {@link DB.close} to reset the
   * singleton.
   */
  static db: ExtendedDb;

  /**
   * The pg-promise root library instance. Unset until `DB.init` has been
   * called.
   *
   * Reassigning this field is discouraged; use {@link DB.close} to reset the
   * singleton.
   */
  static pgp: IMain;

  /**
   * The default instance backing the static fields. Private on purpose: the
   * compatibility surface gains only {@link DB.close}.
   */
  private static _instance?: Database<Repositories>;

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

      // The cast only re-attaches the globally augmented registry type to the
      // factory's inferred one; the runtime path is exactly createDb().
      const instance = createDb({
        connection,
        repositories,
        logger,
        // The singleton's models read the process-wide resolver, so a later
        // setAuditActorResolver() call stays visible to them.
        auditActorResolver: getAuditActor,
      }) as unknown as Database<Repositories>;

      DB._instance = instance;
      DB.db = instance.db;
      DB.pgp = instance.pgp;

      // Register audit actor resolver if provided
      if (options.auditActorResolver) {
        setAuditActorResolver(options.auditActorResolver);
      }
    }

    return DB;
  }

  /**
   * Closes the default instance's pool and resets the singleton so a later
   * `DB.init()` can start cleanly.
   *
   * Clears `DB.db`, `DB.pgp`, and — only when a default instance existed —
   * the audit resolver registered through `DB.init()`.
   *
   * Safe before initialization, and safe to call repeatedly or concurrently.
   * The static fields stay populated until shutdown finishes, so an ordinary
   * `DB.init()` cannot start a second singleton mid-close. Cleanup runs even
   * if ending the pool rejects.
   */
  static async close(): Promise<void> {
    const instance = DB._instance;
    try {
      await instance?.close();
    } finally {
      if (DB._instance === instance) {
        DB._instance = undefined;
        DB.db = undefined as unknown as ExtendedDb;
        DB.pgp = undefined as unknown as IMain;
        // Only what init() registered. Closing an uninitialized singleton must
        // not reset a resolver set for hand-constructed models.
        if (instance) clearAuditActorResolver();
      }
    }
  }
}

/** The initialized pg-promise instance. */
export const pgp = (): IMain => DB.pgp;
export const db = (): ExtendedDb => DB.db;

// Named exports for structured access
export { DB };

// Default export for convenience
export default DB;
