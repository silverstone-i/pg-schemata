/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { z } from 'zod';
import SchemaDefinitionError from '../SchemaDefinitionError.js';
import type { TableSchema, TableValidators } from '../schemaTypes.js';
/**
 * @private
 *
 * Generates a Zod schema validator from a tableSchema object used by pg-schemata.
 * Produces base, insert, and update validators with support for PostgreSQL column types,
 * nullable handling, and basic check constraint interpretation (e.g. char_length, IN()).
 *
 * Returns:
 * - baseValidator: all fields (required if notNull)
 * - insertValidator: only fields required at insert time
 * - updateValidator: all fields optional
 *
 * Note: This function is used internally by TableModel to auto-generate validation schemas.
 */
function mapSqlTypeToZod(type: string, columnName: string): z.ZodTypeAny {
  const varcharMatch = /^varchar\((\d+)\)$/i.exec(type);
  if (varcharMatch?.[1]) {
    const max = parseInt(varcharMatch[1], 10);
    return z.string().max(max);
  } else if (
    /^(text|varchar|char\(\d+\)|character varying(\(\d+\))?)$/i.test(type)
  ) {
    return z.string();
  } else if (/^uuid$/i.test(type)) {
    return z.string().uuid();
  } else if (
    /^(int|integer|smallint|int2|int4|serial|smallserial)$/i.test(type)
  ) {
    return z.number().int();
  } else if (/^(bigint|int8|bigserial)$/i.test(type)) {
    // bigint columns commonly round-trip as strings to avoid precision loss
    return z.union([z.number().int(), z.bigint(), z.string().regex(/^-?\d+$/)]);
  } else if (/^(numeric|decimal)(\(\s*\d+\s*(,\s*\d+\s*)?\))?$/i.test(type)) {
    return z.number();
  } else if (/^(real|double precision|float4|float8)$/i.test(type)) {
    return z.number();
  } else if (/^boolean$/i.test(type)) {
    return z.boolean();
  } else if (
    /^(timestamptz|timestamp|date)(\(\d+\))?( with(out)? time zone)?$/i.test(
      type
    )
  ) {
    return z.coerce.date();
  } else if (/^jsonb?$/i.test(type)) {
    return z.any();
  } else {
    // A type with no validator mapping is a schema-definition error: it
    // would silently accept anything (the pre-2.0.0 z.any() fallback).
    throw new SchemaDefinitionError(
      `No validator mapping for column type "${type}" (column "${columnName}"). Use a supported type or provide colProps.validator.`
    );
  }
}

/**
 * Applies `.min(n)` when the validator supports it (ZodString does); other
 * validator classes pass through unchanged, matching the old duck-typing.
 */
function withMin(validator: z.ZodTypeAny, minLen: number): z.ZodTypeAny {
  if (
    'min' in validator &&
    typeof (validator as { min?: unknown }).min === 'function'
  ) {
    return (validator as z.ZodString).min(minLen);
  }
  return validator;
}

function generateZodFromTableSchema(tableSchema: TableSchema): TableValidators {
  const base: Record<string, z.ZodTypeAny> = {};
  const insert: Record<string, z.ZodTypeAny> = {};
  const update: Record<string, z.ZodTypeAny> = {};

  for (const column of tableSchema.columns) {
    const { name, type, notNull, default: defaultValue } = column;
    let zodType: z.ZodTypeAny =
      column.colProps?.validator || mapSqlTypeToZod(type, name);

    // Enhance email fields. instanceof is stable across zod versions;
    // _def.typeName is a zod 3 internal removed in zod 4 (suggestion 3).
    if (name === 'email' && zodType instanceof z.ZodString) {
      zodType = zodType.email();
    }

    // baseValidator: required if notNull, else optional + nullable
    base[name] = notNull ? zodType : zodType.nullable().optional();

    // insertValidator: required only if notNull and no default, else optional + nullable
    if (notNull && typeof defaultValue === 'undefined') {
      insert[name] = zodType;
    } else {
      insert[name] = zodType.nullable().optional();
    }

    // updateValidator: always optional + nullable
    update[name] = zodType.nullable().optional();
  }

  // Enhance with check constraints if present
  if (
    tableSchema.constraints &&
    Array.isArray(tableSchema.constraints.checks)
  ) {
    // Helper: parse char_length(field) > N and field IN ('A','B','C')
    for (const check of tableSchema.constraints.checks) {
      const expr = typeof check === 'string' ? check : check.expression;
      if (!expr) continue;

      // char_length(field) > N
      let match = /char_length\((\w+)\)\s*>\s*(\d+)/i.exec(expr);
      if (match?.[1] && match[2]) {
        const field = match[1];
        const minLen = parseInt(match[2], 10) + 1;
        // Only apply if field exists
        const baseField = base[field];
        if (baseField) {
          base[field] = withMin(baseField, minLen);
        }
        const insertField = insert[field];
        if (insertField) {
          insert[field] = withMin(insertField, minLen);
        }
        const updateField = update[field];
        if (updateField) {
          update[field] = withMin(updateField, minLen);
        }
        continue;
      }

      // field IN ('A', 'B', 'C')
      match = /^(\w+)\s+IN\s*\(\s*([^)]+)\s*\)$/i.exec(expr);
      if (match?.[1] && match[2]) {
        const field = match[1];
        // Parse enum values: split by comma, remove quotes and trim
        const options = match[2].split(',').map(s =>
          s
            .trim()
            .replace(/^'(.*)'$/, '$1')
            .replace(/^"(.*)"$/, '$1')
        );

        if (options.length > 0) {
          // Non-empty is guaranteed by the length check above; z.enum
          // requires a non-empty tuple type.
          const enumZod = z.enum([...new Set(options)] as [
            string,
            ...string[],
          ]);
          if (base[field]) base[field] = enumZod;
          if (insert[field]) {
            const colDef = tableSchema.columns.find(c => c.name === field);
            if (colDef?.default !== undefined) {
              insert[field] = enumZod.optional();
            } else {
              insert[field] = enumZod;
            }
          }
          if (update[field]) update[field] = enumZod.nullable().optional();
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
