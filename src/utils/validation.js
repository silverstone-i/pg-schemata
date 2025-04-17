'use strict';

/**
 * @fileoverview Utility validation functions for IDs and object types.
 */

 /**
  * Checks if the provided ID is a valid finite number or a non-empty string.
  * @param {number|string} id - The ID to validate.
  * @returns {boolean} True if the ID is a finite number or a non-empty string.
  */
export function isValidId(id) {
  // Allow numeric IDs (finite numbers) or string IDs (non-empty when trimmed)
  return (
    (typeof id === 'number' && Number.isFinite(id)) ||
    (typeof id === 'string' && id.trim().length > 0)
  );
}

/**
 * Validates whether a string matches the UUID v1–v5 format.
 * @param {string} id - The string to test as a UUID.
 * @returns {boolean} True if the string is a valid UUID.
 */
export function validateUUID(id) {
  // Regular expression to match UUID versions 1 through 5
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && UUID_REGEX.test(id);
}

/**
 * Determines if a value is a plain object (i.e., created by {} or Object.create(null)).
 * @param {*} obj - The value to check.
 * @returns {boolean} True if the value is a plain object.
 */
export function isPlainObject(obj) {
  // Exclude null and non-object types early
  if (obj === null || typeof obj !== 'object') return false;
  const proto = Object.getPrototypeOf(obj);
  // A plain object has prototype of Object.prototype or null
  return proto === Object.prototype || proto === null;
}
