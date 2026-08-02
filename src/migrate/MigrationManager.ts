/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/migrate/MigrationManager.ts
//
// MigrationManager orchestrates the discovery and execution of migrations.
// It supports two mutually exclusive input modes:
//
// - Registry mode: ordered arrays of defineMigration() objects per module,
//   with module execution order derived from a topological FK sort.
// - Directory mode: a flat directory of `NNNN_name.mjs` / `NNNN_name.js`
//   files applied in numeric-prefix order under a single module name.
//
// Tracking is per (schema_name, module_name, migration_id) in the target
// schema's `schema_migrations` table. Content hashes are verified on every
// run — an edited applied migration aborts the run. All work happens in one
// transaction guarded by a per-schema advisory lock; errors propagate.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DB } from '../DB.js';
import { SchemaMigrations } from '../models/SchemaMigrations.js';
import { instantiateBound, resolveModuleOrder } from './modelPlanner.js';
import type {
  Migration,
  MigrationContext,
  MigrationModule,
  ModuleDescriptor,
} from './types.js';
import type { DbConnection, Logger } from '../schemaTypes.js';

/** Options accepted by the {@link MigrationManager} constructor. */
export interface MigrationManagerOptions {
  /** Postgres schema to target. Defaults to 'public'. */
  schema?: string;
  /** Registry mode: module descriptors with ordered migration arrays. */
  modules?: ModuleDescriptor[];
  /** Directory mode: directory where migration files live. Defaults to
   * 'migrations' when `modules` is absent. */
  dir?: string;
  /** Directory mode: module_name recorded for scanned files. Defaults to
   * 'default'. */
  moduleName?: string;
  /** Logger passed into migration contexts and model construction. */
  logger?: Logger | null;
}

/** A migration known to the manager, in either mode. */
export interface PendingMigrationInfo {
  /** Owning module name. */
  module: string;
  /** Migration id (registry id, or file name in directory mode). */
  id: string;
  /** Description when provided (registry mode only). */
  description: string | null;
  /** Content checksum (registry) or file-bytes sha256 (directory). */
  checksum: string;
  /** Where the migration came from. */
  source: 'registry' | 'file';
  /** Absolute file path (directory mode only). */
  file?: string;
}

/** Result of {@link MigrationManager.applyAll}. */
export interface ApplyAllResult {
  /** Target Postgres schema. */
  schema: string;
  /** Whether this was a dry run (nothing executed, nothing written). */
  dryRun: boolean;
  /** Module execution order resolved for this run. */
  moduleOrder: string[];
  /** Migrations that were pending at the start of the run, in order. */
  pending: PendingMigrationInfo[];
  /** Migrations actually applied ([] on dry run). */
  applied: PendingMigrationInfo[];
}

/** Internal: a runnable catalog entry. */
interface CatalogEntry extends PendingMigrationInfo {
  run: (context: MigrationContext) => Promise<unknown>;
}

/** Internal: a module's runnable catalog. */
interface ModuleCatalog {
  module: string;
  models: Record<string, unknown>;
  entries: CatalogEntry[];
}

/**
 * Computes a SHA-256 hash for the contents of the given file.
 *
 * @param filePath - Path to the file whose hash should be computed.
 * @returns Hex encoded 64-character hash.
 */
async function computeFileHash(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Projects a runnable catalog entry down to its public info shape.
 *
 * @param entry - Catalog entry.
 * @returns The entry without its `run` function.
 */
function toInfo(entry: CatalogEntry): PendingMigrationInfo {
  const { module, id, description, checksum, source, file } = entry;
  return file === undefined
    ? { module, id, description, checksum, source }
    : { module, id, description, checksum, source, file };
}

/**
 * Enables Postgres extensions on the given executor.
 *
 * @param t - pg-promise transaction or connection.
 * @param extensions - Extension names (identifier-quoted).
 */
async function ensureExtensions(
  t: DbConnection,
  extensions: string[]
): Promise<void> {
  for (const extension of extensions) {
    await t.none('CREATE EXTENSION IF NOT EXISTS $1:name', extension);
  }
}

/**
 * Discovers, verifies, and applies migrations for one Postgres schema.
 */
export class MigrationManager {
  schema: string;
  logger: Logger | null;
  private readonly mode: 'registry' | 'dir';
  private readonly modules: ModuleDescriptor[];
  private readonly dir: string;
  private readonly moduleName: string;

  /**
   * Constructs a manager in registry mode (pass `modules`) or directory
   * mode (pass `dir`/`moduleName`, or nothing for the defaults).
   *
   * @throws {TypeError} If both `modules` and `dir`/`moduleName` are given.
   */
  constructor({
    schema = 'public',
    modules,
    dir,
    moduleName,
    logger = null,
  }: MigrationManagerOptions = {}) {
    if (modules && (dir !== undefined || moduleName !== undefined)) {
      throw new TypeError(
        'Provide either modules (registry mode) or dir/moduleName (directory mode), not both'
      );
    }
    this.schema = schema;
    this.logger = logger;
    this.mode = modules ? 'registry' : 'dir';
    this.modules = modules ?? [];
    this.dir = dir ?? 'migrations';
    this.moduleName = moduleName ?? 'default';

    if (this.mode === 'registry') {
      const seen = new Set<string>();
      for (const moduleDef of this.modules) {
        if (seen.has(moduleDef.name)) {
          throw new TypeError(
            `Duplicate module name "${moduleDef.name}" in migration registry`
          );
        }
        seen.add(moduleDef.name);
        const ids = new Set<string>();
        for (const migration of moduleDef.migrations) {
          if (ids.has(migration.id)) {
            throw new TypeError(
              `Duplicate migration id "${migration.id}" in module "${moduleDef.name}"`
            );
          }
          ids.add(migration.id);
        }
      }
    }
  }

  /**
   * Throws when the target schema contains a pg-schemata 1.x
   * schema_migrations table (legacy `(schema_name, version)` shape).
   * Detection is a read; nothing is modified.
   *
   * @param t - pg-promise transaction or connection.
   */
  private async assertNotLegacy(t: DbConnection): Promise<void> {
    const legacy: unknown = await t.oneOrNone(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'schema_migrations' AND column_name = 'version'`,
      [this.schema]
    );
    if (legacy) {
      throw new Error(
        `Schema "${this.schema}" contains a pg-schemata 1.x schema_migrations table ` +
          `(legacy (schema_name, version) shape), which is incompatible with 2.x tracking ` +
          `(schema_name, module_name, migration_id). No changes were made. Back up and drop ` +
          `or rename "${this.schema}".schema_migrations, then re-run to create the 2.x table ` +
          `and re-baseline. See docs/guide/migrations.md#upgrading-from-1x.`
      );
    }
  }

  /**
   * Ensures the `schema_migrations` table exists in the target schema,
   * failing first if a legacy 1.x table is found.
   *
   * @param t - pg-promise transaction or connection.
   */
  async ensure(t: DbConnection): Promise<void> {
    await this.assertNotLegacy(t);
    const migrationsRepo = new SchemaMigrations(t, DB.pgp, this.logger);
    await migrationsRepo.forSchema(this.schema).createTable();
  }

  /**
   * Loads the applied set for this schema, grouped by module.
   *
   * @param t - pg-promise transaction or connection.
   * @returns Map of module name to (migration id -> stored hash).
   */
  private async loadApplied(
    t: DbConnection
  ): Promise<Map<string, Map<string, string>>> {
    const rows = await t.any<{
      module_name: string;
      migration_id: string;
      hash: string;
    }>(
      `SELECT module_name, migration_id, hash FROM $1:name.schema_migrations WHERE schema_name = $2`,
      [this.schema, this.schema]
    );
    const applied = new Map<string, Map<string, string>>();
    for (const row of rows) {
      let forModule = applied.get(row.module_name);
      if (!forModule) {
        forModule = new Map<string, string>();
        applied.set(row.module_name, forModule);
      }
      forModule.set(row.migration_id, row.hash);
    }
    return applied;
  }

  /**
   * Checks whether the schema_migrations table exists in the target schema.
   *
   * @param t - pg-promise transaction or connection.
   * @returns True when the tracking table exists.
   */
  private async trackingTableExists(t: DbConnection): Promise<boolean> {
    const row: unknown = await t.oneOrNone(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = 'schema_migrations'`,
      [this.schema]
    );
    return row !== null;
  }

  /**
   * Builds the runnable catalog for both modes: module order resolved,
   * models constructed and schema-bound, entries in execution order.
   *
   * @param t - pg-promise transaction or connection (models bind to it).
   * @returns Per-module catalogs in execution order.
   */
  private async loadCatalog(t: DbConnection): Promise<ModuleCatalog[]> {
    if (this.mode === 'registry') {
      const order = resolveModuleOrder(
        this.modules,
        this.schema,
        t,
        DB.pgp,
        this.logger
      );
      const byName = new Map(this.modules.map(m => [m.name, m]));
      return order.map(name => {
        const moduleDef = byName.get(name)!;
        const models: Record<string, unknown> = {};
        for (const [key, Ctor] of Object.entries(moduleDef.models ?? {})) {
          models[key] = instantiateBound(
            Ctor,
            this.schema,
            t,
            DB.pgp,
            this.logger
          );
        }
        return {
          module: name,
          models,
          entries: moduleDef.migrations.map((migration: Migration) => ({
            module: name,
            id: migration.id,
            description: migration.description ?? null,
            checksum: migration.checksum,
            source: 'registry' as const,
            run: migration.up,
          })),
        };
      });
    }

    // Directory mode: flat scan for NNNN_name.mjs / NNNN_name.js.
    const absDir = path.isAbsolute(this.dir)
      ? this.dir
      : path.resolve(process.cwd(), this.dir);
    const files = await fs.readdir(absDir);
    const matched = files
      .flatMap(f => {
        const match = /^(\d+)[_-].*\.(mjs|js)$/.exec(f);
        if (!match?.[1]) return [];
        return [{ file: f, prefix: Number(match[1]) }];
      })
      .sort((a, b) => a.prefix - b.prefix || a.file.localeCompare(b.file));

    const entries: CatalogEntry[] = [];
    for (const { file } of matched) {
      const full = path.join(absDir, file);
      entries.push({
        module: this.moduleName,
        id: file,
        description: null,
        checksum: await computeFileHash(full),
        source: 'file',
        file: full,
        run: async context => {
          const module = (await import(
            pathToFileURL(full).href
          )) as MigrationModule;
          if (typeof module.up !== 'function') {
            throw new Error(
              `Migration ${file} does not export an async up() function`
            );
          }
          return module.up(context);
        },
      });
    }
    return [{ module: this.moduleName, models: {}, entries }];
  }

  /**
   * Verifies stored hashes for every already-applied catalog entry.
   * Applied rows with no matching catalog entry are ignored (logged at warn
   * when a logger is set).
   *
   * @param catalog - Runnable catalog.
   * @param applied - Applied set from {@link loadApplied}.
   * @throws {Error} On any checksum mismatch.
   */
  private verifyHashes(
    catalog: ModuleCatalog[],
    applied: Map<string, Map<string, string>>
  ): void {
    const catalogIds = new Map<string, Set<string>>();
    for (const moduleCatalog of catalog) {
      const ids = new Set<string>();
      for (const entry of moduleCatalog.entries) {
        ids.add(entry.id);
        const storedHash = applied.get(entry.module)?.get(entry.id);
        if (storedHash !== undefined && storedHash !== entry.checksum) {
          throw new Error(
            `Migration checksum mismatch in schema "${this.schema}", module "${entry.module}", ` +
              `migration "${entry.id}": stored ${storedHash}, current ${entry.checksum}. ` +
              `Applied migrations are immutable — do not edit them; create a new migration instead.`
          );
        }
      }
      catalogIds.set(moduleCatalog.module, ids);
    }
    if (this.logger?.warn) {
      for (const [moduleName, ids] of applied) {
        for (const id of ids.keys()) {
          if (!catalogIds.get(moduleName)?.has(id)) {
            this.logger.warn(
              `[pg-schemata] Applied migration "${id}" (module "${moduleName}", schema "${this.schema}") has no matching catalog entry`
            );
          }
        }
      }
    }
  }

  /**
   * Lists migrations not yet applied to the target schema, in execution
   * order. Covers both modes; stored hashes are verified along the way.
   *
   * @param t - pg-promise transaction or connection. Defaults to the pool.
   * @returns Pending migrations in execution order.
   */
  async listPending(t: DbConnection = DB.db): Promise<PendingMigrationInfo[]> {
    await this.assertNotLegacy(t);
    const applied = (await this.trackingTableExists(t))
      ? await this.loadApplied(t)
      : new Map<string, Map<string, string>>();
    const catalog = await this.loadCatalog(t);
    this.verifyHashes(catalog, applied);
    return this.pendingOf(catalog, applied).map(entry => toInfo(entry));
  }

  /**
   * Filters the catalog down to entries not present in the applied set.
   *
   * @param catalog - Runnable catalog.
   * @param applied - Applied set.
   * @returns Pending entries in execution order.
   */
  private pendingOf(
    catalog: ModuleCatalog[],
    applied: Map<string, Map<string, string>>
  ): CatalogEntry[] {
    const pending: CatalogEntry[] = [];
    for (const moduleCatalog of catalog) {
      for (const entry of moduleCatalog.entries) {
        if (!applied.get(entry.module)?.has(entry.id)) pending.push(entry);
      }
    }
    return pending;
  }

  /**
   * Applies all pending migrations in a single transaction guarded by a
   * per-schema advisory lock. Stored hashes are verified before anything
   * executes; a dry run reports pending migrations and writes nothing.
   *
   * @param options - Pass `dryRun: true` to preview without executing.
   * @returns The run result, including pending and applied migrations.
   */
  async applyAll({
    dryRun = false,
  }: { dryRun?: boolean } = {}): Promise<ApplyAllResult> {
    return DB.db.tx(async t => {
      // Serialize migration runs per schema.
      await t.one('SELECT pg_advisory_xact_lock(hashtext($1))', [this.schema]);

      await this.assertNotLegacy(t);

      let applied: Map<string, Map<string, string>>;
      if (dryRun) {
        // Dry run makes zero writes — no ensure(); an absent tracking
        // table just means nothing is applied yet.
        applied = (await this.trackingTableExists(t))
          ? await this.loadApplied(t)
          : new Map<string, Map<string, string>>();
      } else {
        await this.ensure(t);
        applied = await this.loadApplied(t);
      }

      const catalog = await this.loadCatalog(t);
      this.verifyHashes(catalog, applied);

      const moduleOrder = catalog.map(c => c.module);
      const pendingEntries = this.pendingOf(catalog, applied);
      const pending = pendingEntries.map(entry => toInfo(entry));

      if (dryRun) {
        return {
          schema: this.schema,
          dryRun: true,
          moduleOrder,
          pending,
          applied: [],
        };
      }

      const modelsByModule = new Map(
        catalog.map(c => [c.module, c.models] as const)
      );
      for (const entry of pendingEntries) {
        const context: MigrationContext = {
          schema: this.schema,
          module: entry.module,
          db: t,
          pgp: DB.pgp,
          logger: this.logger,
          models: modelsByModule.get(entry.module) ?? {},
          ensureExtensions: extensions => ensureExtensions(t, extensions),
        };
        await entry.run(context);
        await t.none(
          `INSERT INTO $1:name.schema_migrations (schema_name, module_name, migration_id, hash, description)
           VALUES ($2, $3, $4, $5, $6)`,
          [
            this.schema,
            this.schema,
            entry.module,
            entry.id,
            entry.checksum,
            entry.description,
          ]
        );
      }

      return {
        schema: this.schema,
        dryRun: false,
        moduleOrder,
        pending,
        applied: pending,
      };
    });
  }
}
