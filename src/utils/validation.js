'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

import _ from 'lodash';
const { isPlainObject } = _;

/**
 * @private
 *
 * Checks if the provided ID is a valid finite number or a non-empty string.
 *
 * @param {*} id - The value to check.
 * @returns {boolean} True if id is a valid string or finite number.
 */
export function isValidId(id) {
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
 * @param {string} id - The string to test as a UUID.
 * @returns {boolean} True if the string matches a UUID pattern.
 */
export function validateUUID(id) {
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
