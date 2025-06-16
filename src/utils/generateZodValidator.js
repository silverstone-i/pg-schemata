'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

const { z } = require('zod');
/**
 * Generates a Zod schema from a pg-schemata tableSchema object.
 * @param {Object} tableSchema - The pg-schemata tableSchema object containing columns.
 * @returns {z.ZodObject} - The generated Zod schema.
 */
function mapSqlTypeToZod(type) {
  if (/^varchar\((\d+)\)$/i.test(type)) {
    const max = parseInt(type.match(/^varchar\((\d+)\)$/i)[1], 10);
    return z.string().max(max);
  } else if (/^text$/i.test(type)) {
    return z.string();
  } else if (/^uuid$/i.test(type)) {
    return z.string().uuid();
  } else if (/^(int|serial)$/i.test(type)) {
    return z.number().int();
  } else if (/^numeric$/i.test(type)) {
    return z.number();
  } else if (/^boolean$/i.test(type)) {
    return z.boolean();
  } else if (/^(timestamp|date)$/i.test(type)) {
    return z.date();
  } else if (/^jsonb$/i.test(type)) {
    return z.any();
  } else {
    return z.any();
  }
}

function generateZodFromTableSchema(tableSchema) {
  const base = {};
  const insert = {};
  const update = {};

  for (const column of tableSchema.columns) {
    const { name, type, notNull, default: defaultValue } = column;
    const zodType = mapSqlTypeToZod(type);

    // baseValidator: required if notNull, else optional
    base[name] = notNull ? zodType : zodType.optional();

    // insertValidator: required only if notNull and no default, else optional
    if (notNull && typeof defaultValue === 'undefined') {
      insert[name] = zodType;
    } else {
      insert[name] = zodType.optional();
    }

    // updateValidator: always optional
    update[name] = zodType.optional();
  }

  // Enhance with check constraints if present
  if (tableSchema.constraints && Array.isArray(tableSchema.constraints.checks)) {
    // Helper: parse char_length(field) > N and field IN ('A','B','C')
    for (const check of tableSchema.constraints.checks) {
      // char_length(field) > N
      let match = check.match(/char_length\((\w+)\)\s*>\s*(\d+)/i);
      if (match) {
        const field = match[1];
        const minLen = parseInt(match[2], 10) + 1;
        // Only apply if field exists
        if (base[field]) {
          base[field] = base[field].min ? base[field].min(minLen) : base[field];
        }
        if (insert[field]) {
          insert[field] = insert[field].min ? insert[field].min(minLen) : insert[field];
        }
        if (update[field]) {
          update[field] = update[field].min ? update[field].min(minLen) : update[field];
        }
        continue;
      }

      // field IN ('A', 'B', 'C')
      match = check.match(/^(\w+)\s+IN\s*\(\s*([^)]+)\s*\)$/i);
      if (match) {
        const field = match[1];
        // Parse enum values: split by comma, remove quotes and trim
        const options = match[2].split(',').map(s =>
          s
            .trim()
            .replace(/^'(.*)'$/, '$1')
            .replace(/^"(.*)"$/, '$1')
        );
        if (base[field]) {
          base[field] = z.enum(options);
        }
        if (insert[field]) {
          insert[field] = z.enum(options);
        }
        if (update[field]) {
          update[field] = z.enum(options).optional();
        }
        continue;
      }
    }
  }

  return {
    baseValidator: z.object(base),
    insertValidator: z.object(insert),
    updateValidator: z.object(update),
  };
}

export { generateZodFromTableSchema };
