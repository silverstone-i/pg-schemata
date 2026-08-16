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
 * Re-export of lodash's isPlainObject utility.
 */
export { isPlainObject };
