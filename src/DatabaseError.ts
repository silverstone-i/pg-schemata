/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

/**
 * Shape of the PostgreSQL error metadata extracted from pg / pg-promise
 * errors. All fields are optional because drivers do not guarantee them.
 */
export interface PgErrorLike {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
}

/**
 * Custom error class for representing PostgreSQL-related database errors.
 * Wraps the original error thrown by pg-promise or pg, and extracts useful metadata
 * such as the constraint name, table, and SQLSTATE error code.
 */
class DatabaseError extends Error {
  /** SQLSTATE error code (e.g. '23505'). */
  code: string | undefined;
  /** Detailed error description from PostgreSQL. */
  detail: string | undefined;
  /** Name of the violated constraint, if any. */
  constraint: string | undefined;
  /** Table the error relates to, if reported. */
  table: string | undefined;
  /** The original error object from PostgreSQL. */
  original: (Error & PgErrorLike) | undefined;

  /**
   * Constructs a new DatabaseError instance.
   * @param message - A human-readable description of the error.
   * @param originalError - The original error object from PostgreSQL.
   */
  constructor(message: string, originalError?: Error & PgErrorLike) {
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
export { DatabaseError };
