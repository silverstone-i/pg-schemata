/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import type { Logger, LogLevel } from '../schemaTypes.js';

/** Parameters accepted by {@link logMessage}. */
export interface LogMessageParams {
  /** Logger instance (e.g. Winston). */
  logger: Logger | null | undefined;
  /** Log level; defaults to 'debug'. */
  level?: LogLevel;
  /** Optional schema name to include in prefix. */
  schema?: string;
  /** Optional table name to include in prefix. */
  table?: string;
  /** Message string or structured data. */
  message: string | object;
  /** Additional metadata for structured logging. */
  data?: unknown;
}

/**
 * @private
 *
 * Logs a formatted message with optional metadata, scoped by schema and table name.
 * Every message is handed to the host logger; level filtering is the
 * logger's decision, not the library's.
 */
export function logMessage({
  logger,
  level = 'debug',
  schema,
  table,
  message,
  data = null,
}: LogMessageParams): void {
  if (!logger) return;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked below via fn.call(logger, ...)
  const fn = logger[level];
  if (typeof fn !== 'function') return;

  const schemaInfo = schema && table ? `[${schema}.${table}]` : '';
  const prefix = `${schemaInfo} ${typeof message === 'string' ? message : JSON.stringify(message)}`;

  if (data) {
    fn.call(logger, prefix, data);
  } else {
    fn.call(logger, prefix);
  }
}
