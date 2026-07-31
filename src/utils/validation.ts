/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import _ from 'lodash';
// eslint-disable-next-line @typescript-eslint/unbound-method -- lodash functions are this-free
const { isPlainObject } = _;

/**
 * @private
 *
 * Checks if the provided ID is a valid finite number or a non-empty string.
 *
 * @param id - The value to check.
 * @returns True if id is a valid string or finite number.
 */
export function isValidId(id: unknown): id is number | string {
  // Allow numeric IDs (finite numbers) or string IDs (non-empty when trimmed)
  return (
    (typeof id === 'number' && Number.isFinite(id)) ||
    (typeof id === 'string' && id.trim().length > 0)
  );
}

/**
 * @private
 *
 * Validates whether a string matches the UUID v1–v5 format.
 *
 * @param id - The string to test as a UUID.
 * @returns True if the string matches a UUID pattern.
 */
export function validateUUID(id: unknown): boolean {
  // Regular expression to match UUID versions 1 through 5
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && UUID_REGEX.test(id);
}

/**
 * @private
 *
 * Re-export of lodash's isPlainObject utility.
 */
export { isPlainObject };
