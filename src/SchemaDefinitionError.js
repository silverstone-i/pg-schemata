/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
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
