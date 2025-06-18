'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

export function logMessage({ logger, level = 'debug', schema, table, message, data = null }) {
  if (!logger || typeof logger[level] !== 'function') return;

  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' && level === 'debug') return;

  const schemaInfo = schema && table ? `[${schema}.${table}]` : '';
  const prefix = `${schemaInfo} ${typeof message === 'string' ? message : JSON.stringify(message)}`;  

  data ? logger[level](prefix, data) : logger[level](prefix);
}