/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

/**
 * Custom error used to indicate problems with table schema definitions or data validation
 * within pg-schemata. This is typically thrown during insert/update validation or schema parsing.
 */
class SchemaDefinitionError extends Error {
  /** Optional original error cause for tracing. */
  original: Error | null;

  /**
   * Constructs a new SchemaDefinitionError.
   * @param message - Error message describing the schema issue.
   * @param originalError - Optional original error cause for tracing.
   */
  constructor(message: string, originalError: Error | null = null) {
    super(message);
    this.name = 'SchemaDefinitionError';
    this.original = originalError;
  }
}

export default SchemaDefinitionError;
export { SchemaDefinitionError };
