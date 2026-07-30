/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/migrate/MigrationManager.ts
//
// MigrationManager orchestrates the discovery and execution of migration
// scripts. It manages version tracking via the SchemaMigrations model,
// applies new migrations within a single transaction, and records each
// application in the `schema_migrations` table.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DB } from '../DB.js';
import { SchemaMigrations } from '../models/SchemaMigrations.js';
import type { DbConnection } from '../schemaTypes.js';

/** Options accepted by the {@link MigrationManager} constructor. */
export interface MigrationManagerOptions {
  /** Postgres schema to target. Defaults to 'public'. */
  schema?: string;
  /** Directory where migration files live. Defaults to 'migrations'. */
  dir?: string;
}

/** A discovered migration file pending application. */
export interface PendingMigration {
  /** File name (e.g. '0001_initial.mjs'). */
  file: string;
  /** Numeric version parsed from the file name prefix. */
  version: number;
  /** Absolute path to the migration file. */
  full: string;
}

/** The context object passed to each migration's `up` function. */
export interface MigrationContext {
  db: DbConnection;
  schema: string;
}

/** The module shape a migration file must export. */
export interface MigrationModule {
  up?: (context: MigrationContext) => Promise<unknown>;
}

/**
 * Utility to convert a filesystem path into a file URL. Required for
 * dynamic imports when running under Node.js with `type: module`.
 *
 * @param filePath - Absolute filesystem path
 * @returns A file:// URL suitable for dynamic import()
 */
function pathToFileUrl(filePath: string): string {
  // pathToFileURL is synchronous; convert a filesystem path to a file:// URL
  return pathToFileURL(filePath).href;
}

/**
 * Computes a SHA‑256 hash for the contents of the given file.
 *
 * @param filePath - Path to the file whose hash should be computed
 * @returns Hex encoded 64‑character hash
 */
async function computeFileHash(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * The MigrationManager discovers migration files, applies them in order, and
 * records their execution in the `schema_migrations` table. It uses
 * advisory locks to prevent concurrent migrations on the same schema.
 */
export class MigrationManager {
  schema: string;
  dir: string;

  /**
   * Constructs a manager.
   */
  constructor({
    schema = 'public',
    dir = 'migrations',
  }: MigrationManagerOptions = {}) {
    this.schema = schema;
    this.dir = dir;
  }

  /**
   * Ensures the `schema_migrations` table exists by using the
   * SchemaMigrations model's `createTable` method.
   *
   * @param t - pg‑promise transaction or connection
   */
  async ensure(t: DbConnection): Promise<void> {
    // migrationSchema hardcodes dbSchema 'public'; bind to the target schema
    // so the table is created where currentVersion() and applyAll() read it.
    const migrationsRepo = new SchemaMigrations(t, DB.pgp);
    await migrationsRepo.forSchema(this.schema).createTable();
  }

  /**
   * Retrieves the highest migration version that has been applied to
   * this.schema.
   *
   * @param t - pg‑promise transaction or connection
   * @returns The current version or 0 if no migrations
   */
  async currentVersion(t: DbConnection): Promise<number> {
    const query = `SELECT COALESCE(MAX(version), 0) AS v FROM "${this.schema}"."schema_migrations" WHERE schema_name = $1`;
    const row = await t.oneOrNone<{ v: number }>(query, [this.schema]);
    return row?.v ?? 0;
  }

  /**
   * Discovers migration files in the configured directory and returns
   * those that have a version greater than the current applied version.
   *
   * Migration files must be named with a leading numeric prefix (e.g.
   * 0001_initial.mjs). The prefix determines execution order.
   *
   * @param t - pg‑promise transaction or connection
   */
  async listPending(t: DbConnection): Promise<PendingMigration[]> {
    const current = await this.currentVersion(t);
    const absDir = path.isAbsolute(this.dir)
      ? this.dir
      : path.resolve(process.cwd(), this.dir);
    const files = await fs.readdir(absDir);
    // Filter to migration files with numeric prefix; flatMap over the regex
    // result keeps the version capture and the filter in one pass.
    const migrationFiles = files
      .flatMap<PendingMigration>(f => {
        const match = /^(\d+)_.*\.mjs$/.exec(f);
        if (!match?.[1]) return [];
        return [
          {
            file: f,
            version: Number(match[1]),
            full: path.join(absDir, f),
          },
        ];
      })
      .sort((a, b) => a.version - b.version);
    return migrationFiles.filter(m => m.version > current);
  }

  /**
   * Applies all pending migrations in a single transaction.
   *
   * Migration files must export an async `up({ db, schema })` function. The
   * `db` argument will be a pg‑promise transaction object and `schema`
   * will be the configured Postgres schema name. If a migration fails,
   * the entire transaction is rolled back.
   *
   * @returns Count and names of applied migrations
   */
  async applyAll(): Promise<{ applied: number; files: string[] }> {
    const result = await DB.db.tx(async t => {
      // Acquire an advisory lock scoped to the schema name to prevent
      // concurrent migration runs.
      await t.one('SELECT pg_advisory_xact_lock(hashtext($1))', [this.schema]);

      // Ensure the schema_migrations table exists
      await this.ensure(t);

      // Determine which migration files need to run
      const pending = await this.listPending(t);
      for (const migration of pending) {
        const module = (await import(
          pathToFileUrl(migration.full)
        )) as MigrationModule;
        if (typeof module.up !== 'function') {
          throw new Error(
            `Migration ${migration.file} does not export an async up() function`
          );
        }
        await module.up({ db: t, schema: this.schema });
        const hash = await computeFileHash(migration.full);
        // Record the execution of this migration
        const insertSql = `INSERT INTO "${this.schema}"."schema_migrations" (schema_name, version, hash, label) VALUES ($1, $2, $3, $4)`;
        await t.none(insertSql, [
          this.schema,
          migration.version,
          hash,
          migration.file,
        ]);
      }
      return { applied: pending.length, files: pending.map(m => m.file) };
    });
    return result;
  }
}
