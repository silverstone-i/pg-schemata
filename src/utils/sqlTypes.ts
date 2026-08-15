/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

/**
 * @private
 *
 * Shared SQL type-string helpers.
 *
 * Lives in its own module because both the validator generator and the
 * ColumnSet builder need the same notion of "what type is this", and they
 * previously disagreed: the generator normalized the string while the builder
 * compared it literally, so `SERIAL` validated but was not recognized as
 * auto-generated.
 */

/**
 * Canonicalizes a declared column type: trimmed, interior whitespace runs
 * collapsed to a single space, lowercased.
 *
 * Whitespace is *collapsed*, not stripped — `double precision` and
 * `with time zone` are multi-word, so removing spaces outright would break
 * them.
 *
 * @param type - Declared column type, in any casing or spacing.
 * @returns The canonical form used for all type matching.
 */
export function normalizeSqlType(type: string): string {
  return type.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Every spelling of PostgreSQL's auto-incrementing pseudo-types.
 *
 * `serial` and friends are not real types — PostgreSQL rewrites them into an
 * integer column with a sequence-backed DEFAULT — so a value is generated
 * whether or not the schema declares `default`.
 */
const SERIAL_TYPES: ReadonlySet<string> = new Set([
  'serial',
  'serial2',
  'serial4',
  'serial8',
  'smallserial',
  'bigserial',
]);

/**
 * Whether a normalized type is an auto-incrementing pseudo-type.
 *
 * Callers must normalize first (see {@link normalizeSqlType}); taking the
 * canonical form as input keeps the two call sites from drifting again.
 *
 * @param normalized - A type string already passed through normalizeSqlType.
 * @returns True for serial, serial2/4/8, smallserial, and bigserial.
 */
export function isSerialType(normalized: string): boolean {
  return SERIAL_TYPES.has(normalized);
}
