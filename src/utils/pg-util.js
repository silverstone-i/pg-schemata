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
 * @private
 *
 * Logs a formatted message with optional metadata, scoped by schema and table name.
 * Skips debug-level messages in production environments.
 *
 * @param {Object} params - Logging parameters.
 * @param {Object} params.logger - Logger instance (e.g. Winston).
 * @param {string} [params.level='debug'] - Log level (e.g. 'info', 'warn', 'error').
 * @param {string} [params.schema] - Optional schema name to include in prefix.
 * @param {string} [params.table] - Optional table name to include in prefix.
 * @param {string|Object} params.message - Message string or structured data.
 * @param {Object} [params.data=null] - Additional metadata for structured logging.
 */
export function logMessage({ logger, level = 'debug', schema, table, message, data = null }) {
  if (!logger || typeof logger[level] !== 'function') return;

  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' && level === 'debug') return;

  const schemaInfo = schema && table ? `[${schema}.${table}]` : '';
  const prefix = `${schemaInfo} ${typeof message === 'string' ? message : JSON.stringify(message)}`;  

  data ? logger[level](prefix, data) : logger[level](prefix);
}