'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

/**
 * Custom error class for representing PostgreSQL-related database errors.
 * Wraps the original error thrown by pg-promise or pg, and extracts useful metadata
 * such as the constraint name, table, and SQLSTATE error code.
 */
class DatabaseError extends Error {
  /**
   * Constructs a new DatabaseError instance.
   * @param {string} message - A human-readable description of the error.
   * @param {Error} originalError - The original error object from PostgreSQL.
   */
  constructor(message, originalError) {
    super(message);
    this.name = 'DatabaseError';
    this.code = originalError?.code;
    this.detail = originalError?.detail;
    this.constraint = originalError?.constraint;
    this.table = originalError?.table;
    this.original = originalError;
  }
}

export default DatabaseError;
