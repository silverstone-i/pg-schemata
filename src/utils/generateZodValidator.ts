/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { z } from 'zod';
import SchemaDefinitionError from '../SchemaDefinitionError.js';
import type { TableSchema, TableValidators } from '../schemaTypes.js';
/**
 * Time-of-day pattern for `time` columns.
 *
 * Hand-rolled rather than `z.iso.time()`, which rejects `24:00:00` — a legal
 * end-of-day value Postgres accepts and stores. A validator stricter than the
 * database rejects valid rows.
 *
 * `24:00` is a separate alternative rather than a widened hour class because
 * Postgres accepts `24:00:00` but rejects `24:00:01`. Seconds are optional
 * (`'12:00'::time` is valid) and the fractional part is unbounded, since
 * Postgres rounds excess precision rather than erroring.
 *
 * An offset is deliberately not accepted here: `'07:00:00+01'::time` silently
 * discards it, and surfacing that is more useful than accepting data loss.
 */
const TIME_RE =
  /^(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?|24:00(?::00(?:\.0+)?)?)$/;

/**
 * As {@link TIME_RE}, plus an optional UTC designator or numeric offset.
 * Offset hours cap at 15, matching Postgres's legal range, and the minute
 * separator is optional (`+0130` and `+01:30` are both accepted input).
 * The `[Zz]` class is explicit because this matches values, not type names,
 * so the case-normalization applied to type strings does not reach it.
 */
const TIMETZ_RE =
  /^(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?|24:00(?::00(?:\.0+)?)?)(?:[+-](?:0\d|1[0-5])(?::?[0-5]\d)?(?::[0-5]\d)?|[Zz])?$/;

/**
 * numeric/decimal accept a string as well as a number: pg returns OID 1700 as
 * a string to preserve precision, exactly as it does for int8, so a row read
 * back from the database must still satisfy its own validator.
 */
const NUMERIC_VALIDATOR: z.ZodType = z.union([
  z.number(),
  z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/),
]);

/**
 * Types deliberately left unmapped, with the reason surfaced to the caller.
 *
 * Both round-trip asymmetrically — pg returns an object (`interval`) or a
 * Buffer (`bytea`) while inserts accept a string — so any built-in validator
 * would have to be a union broad enough to accept nearly anything, which is
 * worse than no validator because it looks like protection.
 */
const UNSUPPORTED_TYPES: Readonly<Record<string, string>> = {
  interval:
    'pg returns an object while inserts accept a string, so no built-in validator can be both correct and useful',
  bytea:
    'pg returns a Buffer while inserts accept a string, so no built-in validator can be both correct and useful',
};

/**
 * Exact type-name matches. A lookup table rather than a regex alternation so
 * prefix pairs (`int`/`int8`, `time`/`timestamp`, `bool`/`boolean`,
 * `text`/`citext`, `char`/`character varying`) cannot shadow one another —
 * with exact keys that failure mode is structurally impossible.
 *
 * Schemas are immutable in zod, so sharing one instance per type is safe.
 */
const SCALAR_TYPES: Readonly<Record<string, z.ZodType>> = {
  // Strings. Bare char/bpchar/character stay unbounded: Postgres treats bare
  // `char` as `char(1)`, but blank-pads on store, so enforcing .max(1) would
  // be a second length tightening on top of the char(n) fix below.
  text: z.string(),
  varchar: z.string(),
  'character varying': z.string(),
  char: z.string(),
  bpchar: z.string(),
  character: z.string(),
  citext: z.string(),

  // z.guid(), not z.uuid(): zod 4's uuid() enforces the RFC 4122 variant bits
  // and rejects values Postgres stores happily (any variant nibble outside
  // 8/9/a/b, including the all-F GUID). z.guid() matches both Postgres's own
  // validation and zod 3's z.string().uuid() behaviour.
  uuid: z.guid(),

  // Integers.
  smallint: z.number().int(),
  int2: z.number().int(),
  int: z.number().int(),
  integer: z.number().int(),
  int4: z.number().int(),
  smallserial: z.number().int(),
  serial2: z.number().int(),
  serial: z.number().int(),
  serial4: z.number().int(),

  // 64-bit integers round-trip as strings to avoid precision loss.
  bigint: z.union([z.number().int(), z.bigint(), z.string().regex(/^-?\d+$/)]),
  int8: z.union([z.number().int(), z.bigint(), z.string().regex(/^-?\d+$/)]),
  bigserial: z.union([
    z.number().int(),
    z.bigint(),
    z.string().regex(/^-?\d+$/),
  ]),
  serial8: z.union([z.number().int(), z.bigint(), z.string().regex(/^-?\d+$/)]),

  numeric: NUMERIC_VALIDATOR,
  decimal: NUMERIC_VALIDATOR,

  // Floats are returned as JS numbers.
  real: z.number(),
  float4: z.number(),
  float8: z.number(),
  'double precision': z.number(),
  float: z.number(),

  boolean: z.boolean(),
  bool: z.boolean(),

  // pg parses these into Date objects, unlike time/timetz below.
  date: z.coerce.date(),
  timestamp: z.coerce.date(),
  timestamptz: z.coerce.date(),

  // Network types have no round-trip surprises; a stricter check is an easy
  // colProps.validator upgrade and risks rejecting valid exotic spellings.
  inet: z.string(),
  cidr: z.string(),
  macaddr: z.string(),
  macaddr8: z.string(),

  // pg leaves OID 1083/1266 unparsed, so these arrive as strings.
  time: z.string().regex(TIME_RE, 'Invalid time'),
  timetz: z.string().regex(TIMETZ_RE, 'Invalid time with time zone'),

  // z.any() would make the object key optional, so a NOT NULL json column
  // would pass with the key absent entirely.
  json: z.unknown().nonoptional(),
  jsonb: z.unknown().nonoptional(),
};

/**
 * Parameterized types, tested in order. Every pattern is anchored, so the
 * prefix relationships noted on {@link SCALAR_TYPES} stay safe here too —
 * but the timestamp entry must precede the time entry regardless, so that a
 * future edit dropping an anchor cannot reroute timestamp columns into the
 * time-string branch.
 */
const PARAMETERIZED: readonly (readonly [
  RegExp,
  (m: RegExpExecArray) => z.ZodType,
])[] = [
  // Sized character types. `character varying(n)` and `char(n)` previously
  // fell through to the unsized branch and silently lost the .max(n) the
  // validation guide has always documented. .max(n) rather than .length(n):
  // input is unpadded and Postgres blank-pads on store.
  [
    /^(?:character varying|varchar|character|bpchar|char) ?\((\d+)\)$/,
    m => z.string().max(parseInt(m[1]!, 10)),
  ],
  [
    /^(?:numeric|decimal) ?\(\s*\d+\s*(?:, ?\d+\s*)?\)$/,
    () => NUMERIC_VALIDATOR,
  ],
  [/^float ?\(\d+\)$/, () => z.number()],
  [
    /^(?:timestamptz|timestamp)(?: ?\(\d+\))?(?: with(?:out)? time zone)?$/,
    () => z.coerce.date(),
  ],
  [
    // `time with time zone` is timetz; `time without time zone` is plain time,
    // so the suffix must be matched in full rather than searched for.
    /^time(tz)?(?: ?\(\d+\))?(?: (with|without) time zone)?$/,
    m =>
      m[1] === 'tz' || m[2] === 'with'
        ? z.string().regex(TIMETZ_RE, 'Invalid time with time zone')
        : z.string().regex(TIME_RE, 'Invalid time'),
  ],
];

/**
 * Maps a PostgreSQL type name to a Zod validator.
 *
 * The type string is normalized once — trimmed, interior whitespace runs
 * collapsed to a single space, lowercased — so every pattern below matches a
 * canonical form and needs no `/i` flag. Whitespace is *collapsed*, not
 * stripped: `double precision` and `with time zone` are multi-word.
 *
 * @param type - Declared column type, in any casing or spacing.
 * @param columnName - Column name, used only in error messages.
 * @returns A validator for the column's values.
 * @throws {SchemaDefinitionError} If the type has no mapping.
 */
function mapSqlTypeToZod(type: string, columnName: string): z.ZodType {
  const normalized = type.trim().replace(/\s+/g, ' ').toLowerCase();
  return mapNormalizedType(normalized, type, columnName, true);
}

/**
 * @param normalized - Canonicalized type string.
 * @param original - Type as the author wrote it, for error messages.
 * @param columnName - Column name, for error messages.
 * @param allowArray - False inside an array element, which is what makes a
 *   second `[]` a multi-dimensional declaration rather than a legal nesting.
 */
function mapNormalizedType(
  normalized: string,
  original: string,
  columnName: string,
  allowArray: boolean
): z.ZodType {
  // Internal pg_type array names (_text, _int4) are legal user-defined type
  // identifiers too, so guessing which the author meant would eventually be
  // wrong. Checked before the array branch so `_text[]` reports this rather
  // than the multi-dimensional error.
  if (normalized.startsWith('_')) {
    throw new SchemaDefinitionError(
      `Column type "${original}" (column "${columnName}") is a PostgreSQL internal array type name. Declare the array as "${normalized.slice(1)}[]".`
    );
  }

  const arrayMatch = /^(.+)\[\s*\d*\s*\]$/.exec(normalized);
  if (arrayMatch?.[1]) {
    if (!allowArray) {
      // Postgres does not enforce declared array dimensions: text[][] and
      // text[] are the same type, and a text[][] column happily stores a flat
      // array. A nested z.array(z.array(...)) would reject rows the database
      // accepts, so refusing the declaration beats generating a wrong one.
      throw new SchemaDefinitionError(
        `Multi-dimensional array type "${original}" (column "${columnName}") is not supported: PostgreSQL does not enforce declared array dimensions, so a nested validator would reject rows the database accepts. Declare it with a single "[]" or provide colProps.validator.`
      );
    }
    return z.array(
      mapNormalizedType(arrayMatch[1].trim(), original, columnName, false)
    );
  }

  const unsupported = UNSUPPORTED_TYPES[normalized];
  if (unsupported) {
    throw new SchemaDefinitionError(
      `Column type "${original}" (column "${columnName}") has no built-in validator by design: ${unsupported}. Provide colProps.validator.`
    );
  }

  const scalar = SCALAR_TYPES[normalized];
  if (scalar) return scalar;

  for (const [pattern, build] of PARAMETERIZED) {
    const match = pattern.exec(normalized);
    if (match) return build(match);
  }

  // A type with no validator mapping is a schema-definition error: it
  // would silently accept anything (the pre-2.0.0 z.any() fallback).
  throw new SchemaDefinitionError(
    `No validator mapping for column type "${original}" (column "${columnName}"). Use a supported type or provide colProps.validator.`
  );
}

/** Constraints inferred from a CHECK expression, keyed by column name. */
interface CheckHints {
  minLen?: number;
  enumOptions?: string[];
}

/**
 * Extracts the check constraints this generator understands.
 *
 * Collected in a separate pass so the results can be applied to the *inner*
 * validator, before the nullable/optional wrapping. Applying them afterwards
 * is what made them silently vanish for nullable columns: the wrapped value is
 * a ZodOptional, which has no `.min`.
 *
 * Only `char_length(col) > N` and `col IN (...)` are recognized; anything else
 * (compound expressions, casts, quoted identifiers) is left alone.
 */
function collectCheckHints(tableSchema: TableSchema): Map<string, CheckHints> {
  const hints = new Map<string, CheckHints>();
  const checks = tableSchema.constraints?.checks;
  if (!Array.isArray(checks)) return hints;

  const hintFor = (field: string): CheckHints => {
    let hint = hints.get(field);
    if (!hint) {
      hint = {};
      hints.set(field, hint);
    }
    return hint;
  };

  for (const check of checks) {
    const expr = typeof check === 'string' ? check : check.expression;
    if (!expr) continue;

    const lengthMatch = /char_length\((\w+)\)\s*>\s*(\d+)/i.exec(expr);
    if (lengthMatch?.[1] && lengthMatch[2]) {
      hintFor(lengthMatch[1]).minLen = parseInt(lengthMatch[2], 10) + 1;
      continue;
    }

    const inMatch = /^(\w+)\s+IN\s*\(\s*([^)]+)\s*\)$/i.exec(expr);
    if (inMatch?.[1] && inMatch[2]) {
      const options = inMatch[2].split(',').map(s =>
        s
          .trim()
          .replace(/^'(.*)'$/, '$1')
          .replace(/^"(.*)"$/, '$1')
      );
      if (options.length > 0) {
        hintFor(inMatch[1]).enumOptions = [...new Set(options)];
      }
      continue;
    }
  }

  return hints;
}

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
function generateZodFromTableSchema(tableSchema: TableSchema): TableValidators {
  const base: Record<string, z.ZodType> = {};
  const insert: Record<string, z.ZodType> = {};
  const update: Record<string, z.ZodType> = {};

  const hints = collectCheckHints(tableSchema);

  for (const column of tableSchema.columns) {
    const { name, type, notNull, default: defaultValue } = column;
    let zodType: z.ZodType =
      column.colProps?.validator || mapSqlTypeToZod(type, name);

    const hint = hints.get(name);

    // Every refinement below is guarded on ZodString. The old code duck-typed
    // `.min`, which was safe only while arrays were unmappable: z.array() has
    // a `.min` too, and it means array *length*, so a char_length check on a
    // text[] column would have silently become an item-count minimum.
    if (hint?.enumOptions && zodType instanceof z.ZodString) {
      // zod 4 accepts a plain string array; the non-empty tuple cast the
      // zod 3 signature required is no longer needed.
      zodType = z.enum(hint.enumOptions);
    }

    if (hint?.minLen !== undefined && zodType instanceof z.ZodString) {
      zodType = zodType.min(hint.minLen);
    }

    // Enhance email fields. instanceof is stable across zod versions;
    // _def.typeName is a zod 3 internal removed in zod 4 (suggestion 3).
    // .check(z.email()) rather than the deprecated .email(): it composes onto
    // the existing string, so a varchar(n) column keeps its .max(n). Replacing
    // the schema with a bare z.email() would drop the length and is not
    // instanceof ZodString in zod 4.
    if (name === 'email' && zodType instanceof z.ZodString) {
      zodType = zodType.check(z.email());
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

  return {
    baseValidator: z.object(base),
    insertValidator: z.object(insert),
    updateValidator: z.object(update),
  };
}

export { generateZodFromTableSchema };
