/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// src/migrate/defineMigration.ts
//
// Factory for registry migrations. Validates the shape and computes the
// content checksum that MigrationManager verifies on every later run.

import crypto from 'node:crypto';
import type { Migration, MigrationContext } from './types.js';

/** Input accepted by {@link defineMigration}. */
export interface DefineMigrationInput {
  /** Unique id within the module; non-empty string. */
  id: string;
  /** Optional human-readable description. */
  description?: string;
  /** Applies the migration. */
  up: (context: MigrationContext) => Promise<unknown>;
}

/**
 * Creates a frozen, checksummed migration object for registry input.
 *
 * The checksum covers the id, description, and the source text of `up()`
 * (`up.toString()`), so editing an applied migration's body is detected on
 * the next run. Forward-only: there is no `down()`.
 *
 * @param input - Migration id, optional description, and up() function.
 * @returns Frozen {@link Migration}.
 * @throws {TypeError} If id is not a non-empty string, up is not a
 *   function, or description is present but not a string.
 */
export function defineMigration(input: DefineMigrationInput): Migration {
  const { id, description, up } = input;
  if (typeof id !== 'string' || !id.trim()) {
    throw new TypeError('defineMigration: id must be a non-empty string');
  }
  if (typeof up !== 'function') {
    throw new TypeError(`defineMigration: up must be a function (id "${id}")`);
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new TypeError(
      `defineMigration: description must be a string when present (id "${id}")`
    );
  }

  const checksum = crypto
    .createHash('sha256')
    .update(id + (description ?? '') + up.toString())
    .digest('hex');

  return Object.freeze({ id, description, up, checksum });
}
