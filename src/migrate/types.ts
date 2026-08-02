/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/migrate/types.ts
//
// Shared types for the migration machinery: the context handed to every
// migration's up() function, the frozen migration object produced by
// defineMigration(), and the per-module registry descriptor consumed by
// MigrationManager in registry mode.

import type { IMain } from 'pg-promise';
import type { DbConnection, Logger, RepositoryCtor } from '../schemaTypes.js';

/** The context object passed to each migration's `up` function. */
export interface MigrationContext {
  /** Target Postgres schema for this run. */
  schema: string;
  /** Name of the module this migration belongs to ('default' in dir mode). */
  module: string;
  /** The surrounding pg-promise transaction. */
  db: DbConnection;
  /** The pg-promise root library instance. */
  pgp: IMain;
  /** Logger passed to the manager, if any. */
  logger: Logger | null;
  /**
   * The owning module's models, constructed on the transaction and bound to
   * the target schema via forSchema(). Keyed by the registry's model map
   * keys. Empty in directory-scan mode.
   */
  models: Record<string, unknown>;
  /** Enables Postgres extensions via CREATE EXTENSION IF NOT EXISTS. */
  ensureExtensions: (extensions: string[]) => Promise<void>;
}

/**
 * A migration produced by {@link defineMigration}. Forward-only by design —
 * there is no `down()`.
 */
export interface Migration {
  /** Unique id within its module (e.g. '202608020001-initial'). */
  readonly id: string;
  /** Human-readable description, stored alongside the tracking row. */
  readonly description?: string;
  /** Applies the migration. */
  readonly up: (context: MigrationContext) => Promise<unknown>;
  /**
   * sha256 hex of `id + (description ?? '') + up.toString()`, verified
   * against the stored hash on every later run.
   */
  readonly checksum: string;
}

/** A module's entry in the migration registry. */
export interface ModuleDescriptor {
  /** Unique module name; becomes `module_name` in the tracking table. */
  name: string;
  /**
   * Repository constructors owned by this module. Used to derive the
   * module-level FK ordering and to build the `models` in the context.
   */
  models?: Record<string, RepositoryCtor>;
  /**
   * Ordered migrations. Array order is authoritative within a module —
   * the manager never re-sorts it.
   */
  migrations: Migration[];
}

/** The module shape a directory-scanned migration file must export. */
export interface MigrationModule {
  up?: (context: MigrationContext) => Promise<unknown>;
}
