/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { generateZodFromTableSchema } from '../../src/utils/generateZodValidator.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import type { TableSchema } from '../../src/schemaTypes.js';

describe('generateZodFromTableSchema', () => {
  const tableSchema: TableSchema = {
    table: 'test_table',
    dbSchema: 'public',
    columns: [
      { name: 'id', type: 'uuid', notNull: true },
      { name: 'email', type: 'varchar(255)', notNull: true },
      { name: 'phone', type: 'varchar(20)', notNull: false },
      { name: 'notes', type: 'text', notNull: false },
      { name: 'is_active', type: 'boolean', notNull: true, default: true },
      {
        name: 'created_at',
        type: 'timestamp',
        notNull: true,
        default: 'now()',
      },
      { name: 'updated_at', type: 'timestamp', notNull: false },
    ],
  };

  const validators = generateZodFromTableSchema(tableSchema);
  const { insertValidator, updateValidator, baseValidator } = validators;

  it('should require all non-nullable fields without defaults on insert', () => {
    const result = insertValidator.safeParse({
      email: 'a@b.com',
      is_active: true,
      created_at: new Date(),
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some(i => i.path.includes('id'))).toBe(true);
  });

  it('should allow optional nullable fields to be null on insert', () => {
    const input = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: new Date(),
      phone: null,
      notes: null,
      updated_at: null,
    };
    const result = insertValidator.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should mark all update fields as optional and nullable', () => {
    const result = updateValidator.safeParse({ phone: null, notes: null });
    expect(result.success).toBe(true);
  });

  it('should fail on invalid email format in baseValidator', () => {
    const result = baseValidator.safeParse({ email: 'invalid', id: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some(i => i.path.includes('email'))).toBe(true);
  });

  it('should pass with valid UUID and proper email format', () => {
    const result = baseValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'test@example.com',
      is_active: true,
      created_at: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('should enforce max length on varchar fields', () => {
    const result = insertValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a'.repeat(256) + '@test.com',
      is_active: true,
      created_at: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it('should coerce ISO string to date', () => {
    const result = insertValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: '2025-06-16T13:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('should allow defaulted fields to be missing in insert', () => {
    const minimal = insertValidator.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
    });
    expect(minimal.success).toBe(true);
  });

  it('should accept valid enum values and reject invalid ones', () => {
    const enumSchema = {
      ...tableSchema,
      columns: [
        ...tableSchema.columns,
        { name: 'status', type: 'varchar(10)', notNull: true },
      ],
      constraints: {
        checks: [{ expression: "status IN ('active','inactive')" }],
      },
    };

    const { insertValidator: enumInsert } =
      generateZodFromTableSchema(enumSchema);

    const valid = enumInsert.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: new Date(),
      status: 'active',
    });
    expect(valid.success).toBe(true);

    const invalid = enumInsert.safeParse({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      email: 'a@b.com',
      is_active: true,
      created_at: new Date(),
      status: 'deleted',
    });
    expect(invalid.success).toBe(false);
  });

  it('validates integer, bigint, timestamptz, numeric(p,s) and bare varchar instead of z.any() (suggestion 3)', () => {
    // dbSchema is intentionally omitted; the generator only reads columns
    // and constraints.
    const schema = {
      table: 'wide_types',
      columns: [
        { name: 'a_integer', type: 'integer', notNull: true },
        { name: 'a_bigint', type: 'bigint', notNull: true },
        { name: 'a_smallint', type: 'smallint', notNull: true },
        { name: 'a_tstz', type: 'timestamptz', notNull: true },
        { name: 'a_numeric', type: 'numeric(10,2)', notNull: true },
        { name: 'a_varchar', type: 'varchar', notNull: true },
        { name: 'a_double', type: 'double precision', notNull: true },
      ],
      constraints: {},
    };

    const { insertValidator } = generateZodFromTableSchema(
      schema as unknown as TableSchema
    );

    expect(
      insertValidator.safeParse({
        a_integer: 1,
        a_bigint: '9007199254740993',
        a_smallint: 2,
        a_tstz: '2026-01-01T00:00:00Z',
        a_numeric: 1.25,
        a_varchar: 'x',
        a_double: 0.5,
      }).success
    ).toBe(true);

    // The review's repro: garbage previously passed because every one of
    // these types fell through to z.any().
    expect(
      insertValidator.safeParse({
        a_integer: 'NOT A NUMBER',
        a_bigint: {},
        a_smallint: [],
        a_tstz: 'garbage',
        a_numeric: 'NaN-ish',
        a_varchar: 42,
        a_double: 'zero',
      }).success
    ).toBe(false);
  });
});

describe('unknown column types (2.0.0 behavior)', () => {
  it('throws SchemaDefinitionError naming the type and column', () => {
    const schema = {
      table: 'geo_things',
      dbSchema: 'public',
      columns: [
        { name: 'id', type: 'uuid', notNull: true },
        { name: 'footprint', type: 'geometry', notNull: false },
      ],
      constraints: { primaryKey: ['id'] },
    } as unknown as TableSchema;

    expect(() => generateZodFromTableSchema(schema)).toThrow(
      SchemaDefinitionError
    );
    expect(() => generateZodFromTableSchema(schema)).toThrow(
      'No validator mapping for column type "geometry" (column "footprint")'
    );
  });

  it('accepts an unknown type when colProps.validator is provided', () => {
    const schema = {
      table: 'geo_things',
      dbSchema: 'public',
      columns: [
        { name: 'id', type: 'uuid', notNull: true },
        {
          name: 'footprint',
          type: 'geometry',
          notNull: false,
          colProps: { validator: z.string() },
        },
      ],
      constraints: { primaryKey: ['id'] },
    } as unknown as TableSchema;

    expect(() => generateZodFromTableSchema(schema)).not.toThrow();
  });
});

describe('uuid columns map to z.guid(), not z.uuid()', () => {
  // zod 4's z.uuid() enforces the RFC 4122 variant bits and rejects values
  // Postgres stores happily. The obvious mechanical v4 migration is the wrong
  // one, so these cases pin the choice.
  const schema = {
    table: 'guid_things',
    dbSchema: 'public',
    columns: [{ name: 'id', type: 'uuid', notNull: true }],
    constraints: { primaryKey: ['id'] },
  } as unknown as TableSchema;

  const parse = (id: string) =>
    generateZodFromTableSchema(schema).baseValidator.safeParse({ id }).success;

  it('accepts the all-F GUID', () => {
    expect(parse('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toBe(true);
  });

  it('accepts a GUID whose variant nibble is outside RFC 4122', () => {
    // Variant nibble '3' — rejected by z.uuid(), accepted by Postgres.
    expect(parse('aaaaaaaa-1111-2222-3333-444444444444')).toBe(true);
  });

  it('accepts the nil UUID and an ordinary v4 UUID', () => {
    expect(parse('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(parse('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('still rejects a non-GUID string', () => {
    expect(parse('not-a-uuid')).toBe(false);
    expect(parse('')).toBe(false);
  });
});

// ===========================================================================
// 3.0.0 type-mapping coverage
// ===========================================================================

/** Builds a one-column schema and returns its base validator. */
function validatorFor(type: string) {
  return generateZodFromTableSchema({
    table: 'mapping_probe',
    dbSchema: 'public',
    columns: [{ name: 'c', type, notNull: true }],
    constraints: { primaryKey: ['c'] },
  }).baseValidator;
}

/** True when the mapped validator accepts `value`. */
const accepts = (type: string, value: unknown): boolean =>
  validatorFor(type).safeParse({ c: value }).success;

/** Forces generation so a mapping throw surfaces. */
const build = (type: string) => () => validatorFor(type);

describe('type normalization', () => {
  it('trims, lowercases, and collapses interior whitespace', () => {
    expect(accepts('  TEXT  ', 'abc')).toBe(true);
    expect(accepts('DOUBLE   PRECISION', 1.5)).toBe(true);
    expect(accepts('Timestamp Without Time Zone', '2020-01-01')).toBe(true);
    expect(accepts('VARCHAR(10)', 'abc')).toBe(true);
    expect(accepts('varchar (10)', 'abc')).toBe(true);
  });

  it('collapses whitespace rather than stripping it', () => {
    // 'double precision' is multi-word; stripping would make this valid.
    expect(build('doubleprecision')).toThrow(SchemaDefinitionError);
  });

  it('preserves the author casing in error messages', () => {
    expect(build('GEOMETRY')).toThrow(
      'No validator mapping for column type "GEOMETRY"'
    );
  });
});

describe('one-dimensional array types', () => {
  it('maps text[] and rejects a bare scalar', () => {
    expect(accepts('text[]', ['a', 'b'])).toBe(true);
    expect(accepts('text[]', 'a')).toBe(false);
    expect(accepts('text[]', [1])).toBe(false);
  });

  it('maps uuid[] with guid semantics', () => {
    expect(accepts('uuid[]', ['FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'])).toBe(
      true
    );
    expect(accepts('uuid[]', ['nope'])).toBe(false);
  });

  it('keeps the element length limit for varchar(n)[]', () => {
    expect(accepts('varchar(10)[]', ['short'])).toBe(true);
    expect(accepts('varchar(10)[]', ['12345678901'])).toBe(false);
  });

  it('maps integer[]', () => {
    expect(accepts('integer[]', [1, 2])).toBe(true);
    expect(accepts('integer[]', [1.5])).toBe(false);
  });

  it('ignores a declared dimension and tolerates whitespace', () => {
    expect(accepts('text[3]', ['a'])).toBe(true);
    expect(accepts('text [ ]', ['a'])).toBe(true);
    expect(accepts('text[ 3 ]', ['a'])).toBe(true);
  });

  it('reports the offending element index', () => {
    const result = validatorFor('integer[]').safeParse({ c: [1, 'x'] });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['c', 1]);
  });

  it('throws on a multi-dimensional declaration', () => {
    // PG does not enforce declared dimensions, so a nested validator would
    // reject rows the database accepts.
    expect(build('text[][]')).toThrow(SchemaDefinitionError);
    expect(build('text[][]')).toThrow('Multi-dimensional array type');
  });

  it('propagates a by-design element throw', () => {
    expect(build('bytea[]')).toThrow('by design');
  });
});

describe('internal pg_type array names', () => {
  it('throws naming the intended spelling', () => {
    expect(build('_text')).toThrow('Declare the array as "text[]"');
    expect(build('_int4')).toThrow('Declare the array as "int4[]"');
  });

  it('prefers the underscore message over the multi-dimensional one', () => {
    expect(build('_text[]')).toThrow('internal array type name');
  });
});

describe('time and timetz map to strings, not dates', () => {
  it.each([
    '07:00:00',
    '00:00:00',
    '23:59:59.999999',
    '12:00',
    '24:00',
    '24:00:00',
    '24:00:00.000',
  ])('time accepts %s', value => {
    expect(accepts('time', value)).toBe(true);
  });

  it.each([
    '24:00:01',
    '25:00:00',
    '07:60:00',
    '07:00:0',
    'abc',
    '',
    '07:00:00 +01',
  ])('time rejects %s', value => {
    expect(accepts('time', value)).toBe(false);
  });

  it('rejects an offset on a non-tz column', () => {
    // PG silently discards it, which is data loss worth surfacing.
    expect(accepts('time', '07:00:00+01')).toBe(false);
  });

  it('is not z.coerce.date()', () => {
    expect(accepts('time', new Date())).toBe(false);
    expect(accepts('time', 25200000)).toBe(false);
  });

  it.each([
    '07:00:00+01',
    '07:00:00-05:30',
    '07:00:00+0130',
    '07:00:00Z',
    '07:00:00z',
    '07:00:00',
  ])('timetz accepts %s', value => {
    expect(accepts('timetz', value)).toBe(true);
  });

  it('timetz rejects an out-of-range offset', () => {
    expect(accepts('timetz', '07:00:00+20:00')).toBe(false);
  });

  it('resolves the with/without time zone spellings', () => {
    expect(accepts('time with time zone', '07:00:00+01')).toBe(true);
    expect(accepts('time without time zone', '07:00:00+01')).toBe(false);
    expect(accepts('time(3)', '07:00:00')).toBe(true);
  });

  it('does not route timestamp types into the time branch', () => {
    for (const type of [
      'timestamp',
      'timestamptz',
      'date',
      'timestamp(3)',
      'timestamp with time zone',
      'timestamptz(6)',
    ]) {
      expect(accepts(type, '2020-01-01T00:00:00Z')).toBe(true);
      expect(accepts(type, 'garbage')).toBe(false);
    }
  });
});

describe('character length limits', () => {
  it('applies .max(n) to character varying(n) and char(n)', () => {
    // Both silently lost the limit before 3.0.0 by falling through to the
    // unsized branch.
    expect(accepts('character varying(5)', 'abcde')).toBe(true);
    expect(accepts('character varying(5)', 'abcdef')).toBe(false);
    expect(accepts('char(5)', 'abcde')).toBe(true);
    expect(accepts('char(5)', 'abcdef')).toBe(false);
  });

  it('still applies .max(n) to varchar(n)', () => {
    expect(accepts('varchar(5)', 'abcdef')).toBe(false);
  });

  it('leaves unsized character types unbounded', () => {
    expect(accepts('character varying', 'x'.repeat(500))).toBe(true);
    expect(accepts('char', 'ab')).toBe(true);
    expect(accepts('bpchar', 'abc')).toBe(true);
    expect(accepts('character', 'ab')).toBe(true);
  });
});

describe('newly mapped scalar aliases', () => {
  it('maps boolean and float aliases', () => {
    expect(accepts('bool', true)).toBe(true);
    expect(accepts('bool', 'yes')).toBe(false);
    expect(accepts('float', 1.5)).toBe(true);
    expect(accepts('float(24)', 1.5)).toBe(true);
    expect(accepts('float', 'x')).toBe(false);
  });

  it('maps the serial family', () => {
    expect(accepts('serial2', 1)).toBe(true);
    expect(accepts('serial4', 1)).toBe(true);
    expect(accepts('serial8', '9007199254740993')).toBe(true);
    expect(accepts('serial4', 1.5)).toBe(false);
  });

  it('maps citext and the network types', () => {
    expect(accepts('citext', 'a')).toBe(true);
    expect(accepts('inet', '1.2.3.4')).toBe(true);
    expect(accepts('cidr', '1.2.3.0/24')).toBe(true);
    expect(accepts('macaddr', '08:00:2b:01:02:03')).toBe(true);
    expect(accepts('inet', 42)).toBe(false);
  });
});

describe('numeric accepts the string pg returns', () => {
  it('accepts both a number and a numeric string', () => {
    // pg returns OID 1700 as a string to preserve precision, so a row read
    // back from the database must satisfy its own validator.
    expect(accepts('numeric', '12.34')).toBe(true);
    expect(accepts('numeric', 12.34)).toBe(true);
    expect(accepts('numeric(10,2)', '12.34')).toBe(true);
    expect(accepts('decimal', '-5')).toBe(true);
    expect(accepts('numeric', '1.5e3')).toBe(true);
  });

  it('rejects a non-numeric string', () => {
    expect(accepts('numeric', 'abc')).toBe(false);
    expect(accepts('numeric', '')).toBe(false);
  });
});

describe('types left unmapped by design', () => {
  it.each(['interval', 'bytea'])(
    '%s throws pointing at colProps.validator',
    type => {
      expect(build(type)).toThrow(SchemaDefinitionError);
      expect(build(type)).toThrow('colProps.validator');
    }
  );

  it('lets colProps.validator bypass every throw', () => {
    const schema = {
      table: 'bypass',
      dbSchema: 'public',
      columns: [
        { name: 'a', type: 'interval', colProps: { validator: z.string() } },
        { name: 'b', type: 'text[][]', colProps: { validator: z.string() } },
        { name: 'c', type: '_text', colProps: { validator: z.string() } },
      ],
      constraints: { primaryKey: ['a'] },
    } as unknown as TableSchema;

    expect(() => generateZodFromTableSchema(schema)).not.toThrow();
  });
});

// ===========================================================================
// Check-constraint and json handling (3.0.0 fixes)
// ===========================================================================

/** Builds validators for a column plus an optional check constraint. */
function withCheck(
  column: Record<string, unknown>,
  check?: string
): ReturnType<typeof generateZodFromTableSchema> {
  return generateZodFromTableSchema({
    table: 'check_probe',
    dbSchema: 'public',
    columns: [column],
    constraints: {
      primaryKey: [column.name as string],
      ...(check ? { checks: [{ expression: check }] } : {}),
    },
  } as unknown as TableSchema);
}

describe('char_length checks apply to the inner validator', () => {
  it('applies the minimum to a notNull string column', () => {
    const v = withCheck(
      { name: 'c', type: 'text', notNull: true },
      'char_length(c) > 3'
    ).baseValidator;
    expect(v.safeParse({ c: 'abc' }).success).toBe(false);
    expect(v.safeParse({ c: 'abcd' }).success).toBe(true);
  });

  it('applies the minimum to a nullable column and still accepts null', () => {
    // Previously dropped: the wrapped value is a ZodOptional, which has no
    // .min, so the duck-typed helper silently did nothing.
    const v = withCheck(
      { name: 'c', type: 'text' },
      'char_length(c) > 3'
    ).baseValidator;
    expect(v.safeParse({ c: 'abc' }).success).toBe(false);
    expect(v.safeParse({ c: 'abcd' }).success).toBe(true);
    expect(v.safeParse({ c: null }).success).toBe(true);
  });

  it('leaves an array column untouched', () => {
    // z.array().min() means item count, so the old duck-typing would have
    // turned this into "at least 4 items".
    const v = withCheck(
      { name: 'c', type: 'text[]', notNull: true },
      'char_length(c) > 3'
    ).baseValidator;
    expect(v.safeParse({ c: ['a'] }).success).toBe(true);
  });

  it('leaves a non-string column untouched', () => {
    const v = withCheck(
      { name: 'c', type: 'integer', notNull: true },
      'char_length(c) > 3'
    ).baseValidator;
    expect(v.safeParse({ c: 1 }).success).toBe(true);
  });
});

describe('IN checks become enums without discarding nullability', () => {
  it('accepts null on a nullable column in all three validators', () => {
    // NULL IN (...) is unknown, and CHECK admits unknown, so Postgres accepts
    // a null here. The generated validator used to reject it.
    const v = withCheck({ name: 'c', type: 'varchar(10)' }, "c IN ('a', 'b')");
    expect(v.baseValidator.safeParse({ c: null }).success).toBe(true);
    expect(v.insertValidator.safeParse({ c: null }).success).toBe(true);
    expect(v.updateValidator.safeParse({ c: null }).success).toBe(true);
    expect(v.baseValidator.safeParse({ c: 'a' }).success).toBe(true);
    expect(v.baseValidator.safeParse({ c: 'z' }).success).toBe(false);
  });

  it('is required on insert for a notNull column with no default', () => {
    const v = withCheck(
      { name: 'c', type: 'varchar(10)', notNull: true },
      "c IN ('a', 'b')"
    ).insertValidator;
    expect(v.safeParse({}).success).toBe(false);
    expect(v.safeParse({ c: 'a' }).success).toBe(true);
  });

  it('is optional on insert for a column with a default', () => {
    const v = withCheck(
      { name: 'c', type: 'varchar(10)', notNull: true, default: "'a'" },
      "c IN ('a', 'b')"
    ).insertValidator;
    expect(v.safeParse({}).success).toBe(true);
  });

  it('leaves a non-string column untouched', () => {
    const v = withCheck(
      { name: 'c', type: 'integer', notNull: true },
      "c IN ('1', '2')"
    ).baseValidator;
    expect(v.safeParse({ c: 7 }).success).toBe(true);
  });

  it('dedupes repeated options', () => {
    const v = withCheck(
      { name: 'c', type: 'text', notNull: true },
      "c IN ('a', 'a', 'b')"
    ).baseValidator;
    expect(v.safeParse({ c: 'a' }).success).toBe(true);
    expect(v.safeParse({ c: 'b' }).success).toBe(true);
    expect(v.safeParse({ c: 'c' }).success).toBe(false);
  });
});

describe('json columns are required when NOT NULL', () => {
  it('rejects a missing key on a NOT NULL jsonb column', () => {
    // z.any() propagates undefined-acceptance into object optionality, so the
    // key could be omitted entirely.
    const v = withCheck({
      name: 'c',
      type: 'jsonb',
      notNull: true,
    }).insertValidator;
    expect(v.safeParse({}).success).toBe(false);
    expect(v.safeParse({ c: { a: 1 } }).success).toBe(true);
  });

  it('accepts null and nested Date values on a nullable column', () => {
    // Not z.json(): that rejects a nested Date, which pg-promise's :json mod
    // handles perfectly well.
    const v = withCheck({ name: 'c', type: 'jsonb' }).baseValidator;
    expect(v.safeParse({ c: null }).success).toBe(true);
    expect(v.safeParse({ c: { createdAt: new Date() } }).success).toBe(true);
  });
});

describe('serial columns are implicitly defaulted on insert', () => {
  /** Builds an insert validator for a single notNull column of `type`. */
  const insertFor = (type: string, extra: Record<string, unknown> = {}) =>
    generateZodFromTableSchema({
      table: 'serial_probe',
      dbSchema: 'public',
      columns: [{ name: 'id', type, notNull: true, ...extra }],
      constraints: { primaryKey: ['id'] },
    }).insertValidator;

  it.each([
    'serial',
    'serial2',
    'serial4',
    'serial8',
    'smallserial',
    'bigserial',
  ])('does not require %s on insert', type => {
    // The database generates the value whether or not `default` is declared,
    // and for plain serial the ColumnSet discards anything supplied.
    expect(insertFor(type).safeParse({}).success).toBe(true);
  });

  it.each(['SERIAL', ' serial '])('normalizes %s before deciding', type => {
    expect(insertFor(type).safeParse({}).success).toBe(true);
  });

  it('still requires a notNull integer with no default (control)', () => {
    // The relaxation must not leak onto ordinary columns.
    expect(insertFor('integer').safeParse({}).success).toBe(false);
  });

  it('still type-checks a serial value when one is supplied', () => {
    expect(insertFor('serial').safeParse({ id: 1 }).success).toBe(true);
    expect(insertFor('serial').safeParse({ id: 'x' }).success).toBe(false);
    expect(insertFor('serial').safeParse({ id: 1.5 }).success).toBe(false);
  });

  it('leaves the base validator requiring the column', () => {
    const base = generateZodFromTableSchema({
      table: 'serial_probe',
      dbSchema: 'public',
      columns: [{ name: 'id', type: 'serial', notNull: true }],
      constraints: { primaryKey: ['id'] },
    }).baseValidator;
    expect(base.safeParse({}).success).toBe(false);
    expect(base.safeParse({ id: 1 }).success).toBe(true);
  });
});
