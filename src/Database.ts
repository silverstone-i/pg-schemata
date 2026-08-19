/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/Database.ts
//
// createDb() builds fully independent database instances. Each one owns its
// own pg-promise root, connection pool, repository registry, logger, audit
// actor resolver, schema cache, migration target, and lifecycle — so one
// process can hold several handles (an admin database and one or more cell
// databases) without any of them observing another's state.
//
// Tenant-to-cell routing, cell discovery, and credential storage are the
// consuming application's responsibility; this module only owns connections.

import pgPromise from 'pg-promise';
import type { IDatabase, IInitOptions, IMain, QueryParam } from 'pg-promise';
import type { IConnectionParameters } from 'pg-promise/typescript/pg-subset.js';
import { LRUCache } from 'lru-cache';
import DatabaseError from './DatabaseError.js';
import { assertValidIdentifier } from './utils/identifiers.js';
import { stampAuditResolver } from './auditScope.js';
import { MigrationManager } from './migrate/MigrationManager.js';
import type {
  ApplyAllResult,
  MigrationManagerOptions,
} from './migrate/MigrationManager.js';
import { bootstrap } from './migrate/bootstrap.js';
import type { BootstrapOptions } from './migrate/bootstrap.js';
import type {
  AuditActorResolver,
  DbConnection,
  Logger,
  RepositoryCtor,
} from './schemaTypes.js';

/** A pg-promise-compatible connection string or configuration object. */
export type ConnectionInput = string | IConnectionParameters;

/** Pool tuning forwarded to node-postgres. */
export interface DatabasePoolConfig {
  /** Maximum number of pooled clients. */
  max?: number;
  /** Milliseconds an idle client is kept before being closed. */
  idleTimeoutMillis?: number;
  /** Milliseconds to wait for a connection before failing. */
  connectionTimeoutMillis?: number;
}

/**
 * Sanitized connection metadata for a {@link Database}.
 *
 * Passwords and connection strings are never copied here, and values that
 * would require parsing a connection string are absent rather than guessed.
 * This is not a claim that credentials are unreachable — the public
 * `instance.db.$cn` still carries whatever pg-promise was given.
 */
export interface DatabaseInfo {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** Whether TLS was configured (presence only, never the material). */
  ssl?: boolean;
  /** Pool values configured through {@link createDb}. */
  pool: Readonly<DatabasePoolConfig>;
}

/** Maps a repository constructor map to the instance types it produces. */
export type RepositoryInstances<C extends Record<string, RepositoryCtor>> = {
  [K in keyof C]: C[K] extends RepositoryCtor<infer I> ? I : never;
};

/** Configuration accepted by {@link createDb}. */
export interface DatabaseConfig<
  C extends Record<string, RepositoryCtor> = Record<never, never>,
> {
  /** A pg-promise connection string or parameters object. */
  connection?: ConnectionInput;
  /** A PostgreSQL connection string. */
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  /** Pool tuning. Not a connection source on its own. */
  pool?: DatabasePoolConfig;
  /** Repository constructors attached to this instance only. */
  repositories?: C;
  /** Logger passed to every repository this instance builds. */
  logger?: Logger | null;
  /** Resolver for created_by / updated_by, scoped to this instance. */
  auditActorResolver?: AuditActorResolver;
  /** Capitalize generated SQL. Defaults to true. */
  capSQL?: boolean;
  /** pg-promise database context. Defaults to a unique per-instance value. */
  context?: unknown;
}

/** Options for {@link Database.migrationManager}. Ownership is not overridable. */
export type DatabaseMigrationManagerOptions = Omit<
  MigrationManagerOptions,
  'db' | 'pgp' | 'auditActorResolver'
>;

/** Options for {@link Database.migrate}. */
export type DatabaseMigrateOptions = DatabaseMigrationManagerOptions & {
  /** Report pending migrations without executing or recording anything. */
  dryRun?: boolean;
};

/** Options for {@link Database.bootstrap}. Ownership is not overridable. */
export type DatabaseBootstrapOptions = Omit<
  BootstrapOptions,
  'db' | 'pgp' | 'owner' | 'auditActorResolver'
>;

/** This instance's repositories, bound to one PostgreSQL schema. */
export type SchemaDatabase<R> = R & {
  /** The owning instance's database object. */
  db: IDatabase<R> & R;
  /** The owning instance's pg-promise root. */
  pgp: IMain;
  /** The bound schema name. */
  schema: string;
};

/** Discrete connection fields, used for the exclusivity check. */
const DISCRETE_KEYS = [
  'host',
  'port',
  'database',
  'user',
  'password',
  'ssl',
] as const;

/**
 * Keys {@link Database.forSchema} uses for the bound result's own metadata. A
 * repository named after one of these would overwrite it, so they are rejected
 * at construction rather than producing a malformed SchemaDatabase.
 */
const RESERVED_REPOSITORY_NAMES = new Set(['db', 'pgp', 'schema']);

/** Pool keys forwarded onto the connection object. */
const POOL_KEYS = [
  'max',
  'idleTimeoutMillis',
  'connectionTimeoutMillis',
] as const;

/** Counter behind the unique default pg-promise database context. */
let nextInstanceId = 1;

/** Resolved connection plus the metadata safe to expose. */
interface ResolvedConnection {
  cn: ConnectionInput;
  info: DatabaseInfo;
}

/**
 * Rejects ambiguous configuration and produces the connection pg-promise
 * receives, without mutating anything the caller owns.
 *
 * @param config - The factory configuration.
 * @returns The connection input and its sanitized metadata.
 * @throws {TypeError} If zero or more than one connection source is given.
 */
function resolveConnection(
  config: DatabaseConfig<Record<string, RepositoryCtor>>
): ResolvedConnection {
  const hasConnection = config.connection !== undefined;
  const hasConnectionString = config.connectionString !== undefined;
  const discrete = DISCRETE_KEYS.filter(key => config[key] !== undefined);

  if (hasConnection && hasConnectionString) {
    throw new TypeError(
      'createDb accepts either "connection" or "connectionString", not both'
    );
  }
  if (hasConnection && discrete.length > 0) {
    throw new TypeError(
      `createDb accepts either "connection" or discrete connection fields (${discrete.join(', ')}), not both`
    );
  }
  if (hasConnectionString && discrete.length > 0) {
    throw new TypeError(
      `createDb accepts either "connectionString" or discrete connection fields (${discrete.join(', ')}), not both`
    );
  }
  if (!hasConnection && !hasConnectionString && discrete.length === 0) {
    throw new TypeError(
      'createDb requires a connection: pass "connection", "connectionString", or discrete fields such as host/database. Pool options alone are not a connection.'
    );
  }

  // Only the keys the caller actually set — an explicit `undefined` in the
  // pool object must not overwrite a value inside a connection object.
  const poolOverrides: Record<string, unknown> = {};
  for (const key of POOL_KEYS) {
    const value = config.pool?.[key];
    if (value !== undefined) poolOverrides[key] = value;
  }
  const hasPoolOverrides = Object.keys(poolOverrides).length > 0;

  let cn: ConnectionInput;
  if (hasConnection) {
    const provided = config.connection!;
    if (typeof provided === 'string') {
      cn = hasPoolOverrides
        ? { connectionString: provided, ...poolOverrides }
        : provided;
    } else {
      // Clone before merging: the caller's object is never modified.
      cn = { ...provided, ...poolOverrides };
    }
  } else if (hasConnectionString) {
    cn = hasPoolOverrides
      ? {
          connectionString: config.connectionString,
          ...poolOverrides,
        }
      : config.connectionString!;
  } else {
    const discreteCn: Record<string, unknown> = {};
    for (const key of DISCRETE_KEYS) {
      if (config[key] !== undefined) discreteCn[key] = config[key];
    }
    cn = { ...discreteCn, ...poolOverrides };
  }

  return { cn, info: buildInfo(cn) };
}

/**
 * Projects a resolved connection down to the metadata safe to publish.
 *
 * @param cn - The resolved connection input.
 * @returns Deep-frozen metadata carrying no secrets.
 */
function buildInfo(cn: ConnectionInput): DatabaseInfo {
  const source = (typeof cn === 'string' ? {} : cn) as Record<string, unknown>;
  const pool: DatabasePoolConfig = {};
  for (const key of POOL_KEYS) {
    const value = source[key];
    if (value !== undefined) pool[key] = value as number;
  }
  const info: DatabaseInfo = { pool: Object.freeze(pool) };
  if (typeof source.host === 'string') info.host = source.host;
  if (typeof source.port === 'number') info.port = source.port;
  if (typeof source.database === 'string') info.database = source.database;
  if (typeof source.user === 'string') info.user = source.user;
  if (source.ssl !== undefined) info.ssl = Boolean(source.ssl);
  return Object.freeze(info);
}

/**
 * Validates and freezes the repository registry before any pool exists, so a
 * bad constructor fails at construction rather than on the first task.
 *
 * @param repositories - The caller's constructor map.
 * @returns A frozen clone the extend hook closes over.
 * @throws {TypeError} If the map or any constructor is invalid, or a name
 *   collides with the SchemaDatabase metadata keys.
 */
function freezeRepositories(
  repositories: Record<string, RepositoryCtor> | undefined
): Readonly<Record<string, RepositoryCtor>> {
  if (repositories === undefined) return Object.freeze({});
  if (
    !repositories ||
    typeof repositories !== 'object' ||
    Array.isArray(repositories)
  ) {
    throw new TypeError('createDb requires a repositories map');
  }
  const clone: Record<string, RepositoryCtor> = {};
  for (const [name, RepoClass] of Object.entries(repositories)) {
    if (RESERVED_REPOSITORY_NAMES.has(name)) {
      throw new TypeError(
        `Repository name "${name}" is reserved: forSchema() uses "db", "pgp", and "schema" for the bound result's own metadata`
      );
    }
    if (typeof RepoClass !== 'function') {
      throw new TypeError(`Repository "${name}" is not a valid constructor`);
    }
    clone[name] = RepoClass;
  }
  return Object.freeze(clone);
}

/**
 * An independently owned database handle.
 *
 * Build one with {@link createDb}; nothing about it is shared with any other
 * instance, and closing it leaves every other instance untouched.
 */
export class Database<R = Record<never, never>> {
  /** This instance's pg-promise database object, with its repositories. */
  readonly db: IDatabase<R> & R;
  /** This instance's pg-promise root. */
  readonly pgp: IMain;
  /** Sanitized connection metadata. */
  readonly info: DatabaseInfo;
  /** Logger handed to every repository this instance builds. */
  readonly logger: Logger | null;

  readonly #repositories: Readonly<Record<string, RepositoryCtor>>;
  readonly #auditActorResolver: AuditActorResolver;
  readonly #schemaCache: LRUCache<string, object>;
  #closed = false;
  #connecting: Promise<void> | undefined;
  #closing: Promise<void> | undefined;

  /**
   * Prefer {@link createDb}, which infers the repository types.
   *
   * @param config - Factory configuration.
   */
  constructor(config: DatabaseConfig<Record<string, RepositoryCtor>>) {
    if (!config || typeof config !== 'object') {
      throw new TypeError('createDb requires a configuration object');
    }
    const repositories = freezeRepositories(config.repositories);
    const { cn, info } = resolveConnection(config);

    this.#repositories = repositories;
    this.logger = config.logger ?? null;
    // Factory instances never fall through to the module-level resolver, so a
    // resolver registered for the compatibility singleton cannot leak in.
    this.#auditActorResolver = config.auditActorResolver ?? ((): null => null);
    this.#schemaCache = new LRUCache<string, object>({
      max: 1000,
      ttl: 1000 * 60 * 60,
    });
    this.info = info;

    const logger = this.logger;
    const resolver = this.#auditActorResolver;
    const initOptions: IInitOptions<R> = {
      capSQL: config.capSQL ?? true,
      // Arrow on purpose: extend runs when a database object, task, or
      // transaction is created, by which point `this.pgp` is assigned.
      extend: (obj: IDatabase<R> & R) => {
        for (const [name, RepoClass] of Object.entries(repositories)) {
          const repo = new RepoClass(obj, this.pgp, logger);
          stampAuditResolver(repo, resolver);
          (obj as unknown as Record<string, unknown>)[name] = repo;
        }
      },
    };

    const pgpRoot = pgPromise(initOptions);
    this.pgp = pgpRoot;
    // A unique database context keeps pg-promise from reporting deliberately
    // separate handles as duplicate database objects, without switching the
    // library's warnings off.
    const dc = config.context ?? { pgSchemataInstance: nextInstanceId++ };
    this.db = pgpRoot<R>(cn, dc);
  }

  /** True once {@link close} has been called. */
  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Verifies the instance can reach PostgreSQL. Concurrent and repeated calls
   * share one attempt; a failed attempt is not memoized, so it can be retried.
   */
  async connect(): Promise<void> {
    this.#assertOpen();
    if (!this.#connecting) {
      const attempt = this.#openConnection().catch((error: unknown) => {
        if (this.#connecting === attempt) this.#connecting = undefined;
        throw error;
      });
      this.#connecting = attempt;
    }
    return this.#connecting;
  }

  /**
   * Ends this instance's pool. Idempotent: concurrent and repeated calls share
   * one shutdown, and the instance is logically closed even if the pool fails
   * to end.
   *
   * `pgp.end()` is never used — it destroys every pool in the process.
   */
  async close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = (async (): Promise<void> => {
      try {
        // Do not end the pool underneath an in-flight connection attempt.
        await this.#connecting?.catch(() => undefined);
        await this.db.$pool.end();
      } finally {
        this.#schemaCache.clear();
      }
    })();
    return this.#closing;
  }

  /** Runs a query on this instance. */
  async query<T = unknown>(
    ...args: Parameters<DbConnection['query']>
  ): Promise<T> {
    this.#assertOpen();
    return this.db.query<T>(...args);
  }

  /** Runs a query expecting no rows. */
  async none(...args: Parameters<DbConnection['none']>): Promise<null> {
    this.#assertOpen();
    return this.db.none(...args);
  }

  /** Runs a query expecting exactly one row. */
  async one<T = unknown>(query: QueryParam, values?: unknown): Promise<T> {
    this.#assertOpen();
    return this.db.one<T>(query, values);
  }

  /** Runs a query expecting zero or one row. */
  async oneOrNone<T = unknown>(
    query: QueryParam,
    values?: unknown
  ): Promise<T | null> {
    this.#assertOpen();
    return this.db.oneOrNone<T | null>(query, values);
  }

  /** Runs a query returning any number of rows. */
  async any<T = unknown>(
    ...args: Parameters<DbConnection['any']>
  ): Promise<T[]> {
    this.#assertOpen();
    return this.db.any<T>(...args);
  }

  /** Runs a query expecting at least one row. */
  async many<T = unknown>(
    ...args: Parameters<DbConnection['many']>
  ): Promise<T[]> {
    this.#assertOpen();
    return this.db.many<T>(...args);
  }

  /** Runs work inside a transaction on this instance. */
  async transaction<T>(work: (tx: DbConnection) => Promise<T>): Promise<T> {
    this.#assertOpen();
    return this.db.tx(t => work(t));
  }

  /** Alias of {@link transaction}, matching pg-promise's naming. */
  async tx<T>(work: (tx: DbConnection) => Promise<T>): Promise<T> {
    return this.transaction(work);
  }

  /** Runs work on a single connection from this instance's pool. */
  async task<T>(work: (t: DbConnection) => Promise<T>): Promise<T> {
    this.#assertOpen();
    return this.db.task(t => work(t));
  }

  /**
   * Returns this instance's repositories bound to an ordinary PostgreSQL
   * schema. Results are cached per schema name in a bounded LRU, so iterating
   * many tenant schemas cannot grow memory without limit.
   *
   * This selects a PostgreSQL schema only — it is not tenant routing, and it
   * does not touch `search_path` or any pooled session state.
   *
   * @param schemaName - Schema to bind.
   * @returns The bound repositories plus this instance's `db` and `pgp`.
   */
  forSchema(schemaName: string): SchemaDatabase<R> {
    this.#assertOpen();
    assertValidIdentifier(schemaName, 'Schema name');
    const cached = this.#schemaCache.get(schemaName);
    if (cached) return cached as SchemaDatabase<R>;

    const bound: Record<string, unknown> = {
      db: this.db,
      pgp: this.pgp,
      schema: schemaName,
    };
    for (const name of Object.keys(this.#repositories)) {
      const repo = (this.db as unknown as Record<string, unknown>)[name];
      bound[name] =
        repo &&
        typeof (repo as { forSchema?: unknown }).forSchema === 'function'
          ? (repo as { forSchema(name: string): unknown }).forSchema(schemaName)
          : repo;
    }
    this.#schemaCache.set(schemaName, bound);
    return bound as SchemaDatabase<R>;
  }

  /**
   * Builds a {@link MigrationManager} that can only target this instance.
   *
   * @param options - Migration options minus the ownership keys.
   */
  migrationManager(
    options: DatabaseMigrationManagerOptions = {}
  ): MigrationManager {
    this.#assertOpen();
    return new MigrationManager({
      ...options,
      logger: options.logger ?? this.logger,
      db: this.db,
      pgp: this.pgp,
      auditActorResolver: this.#auditActorResolver,
    });
  }

  /**
   * Applies pending migrations to this instance only.
   *
   * @param options - Migration options plus `dryRun`.
   */
  async migrate(options: DatabaseMigrateOptions = {}): Promise<ApplyAllResult> {
    const { dryRun = false, ...managerOptions } = options;
    return this.migrationManager(managerOptions).applyAll({ dryRun });
  }

  /**
   * Creates this instance's tables. The transaction always opens through this
   * instance — no executor, pool, or resolver can be supplied by the caller.
   *
   * @param options - Bootstrap options minus the ownership keys.
   */
  async bootstrap(options: DatabaseBootstrapOptions): Promise<void> {
    this.#assertOpen();
    return bootstrap({
      ...options,
      db: undefined,
      owner: this.db,
      pgp: this.pgp,
      auditActorResolver: this.#auditActorResolver,
    });
  }

  /** Sanitized metadata; never the password or connection string. */
  toJSON(): DatabaseInfo {
    return this.info;
  }

  /** Opens and immediately releases one pooled connection. */
  async #openConnection(): Promise<void> {
    const connection = await this.db.connect();
    await connection.done();
  }

  /** Rejects any wrapper call made after {@link close}. */
  #assertOpen(): void {
    if (this.#closed) {
      throw new DatabaseError('Database instance has been closed');
    }
  }
}

/**
 * Creates an independent database instance.
 *
 * ```ts
 * const adminDb = createDb({ connectionString: ADMIN_URL, repositories: { tenants: Tenants } });
 * const cellDb = createDb({ connectionString: CELL_URL, repositories: { orders: Orders } });
 * ```
 *
 * Repository types are inferred per call, so `adminDb` and `cellDb` expose
 * different, correctly typed repositories.
 *
 * @param config - Connection, repositories, and lifecycle configuration.
 * @returns A database instance owning its own pool and registry.
 */
export function createDb<
  const C extends Record<string, RepositoryCtor> = Record<never, never>,
>(config: DatabaseConfig<C>): Database<RepositoryInstances<C>> {
  return new Database<RepositoryInstances<C>>(config);
}
