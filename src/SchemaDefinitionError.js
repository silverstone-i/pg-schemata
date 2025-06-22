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
 * Custom error used to indicate problems with table schema definitions or data validation
 * within pg-schemata. This is typically thrown during insert/update validation or schema parsing.
 */
class SchemaDefinitionError extends Error {
  /**
   * Constructs a new SchemaDefinitionError.
   * @param {string} message - Error message describing the schema issue.
   * @param {Error|null} [originalError=null] - Optional original error cause for tracing.
   */
  constructor(message, originalError = null) {
    super(message);
    this.name = 'SchemaDefinitionError';
    this.original = originalError;
  }
}

export default SchemaDefinitionError;