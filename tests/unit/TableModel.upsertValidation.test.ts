/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// upsert() and bulkUpsert() went straight from sanitization to SQL, so invalid
// types, the automatic email check, and colProps.validator rules all reached the
// database. 3.0.0 runs the insert validator on both.
//
// The existing upsert tests only cover the isPlainObject guard ("DTO must be a
// non-empty object"), which predates this change — nothing asserted that a
// type-invalid DTO is now rejected, or that the rejection carries a Zod issue
// array in `.cause` rather than a raw error.

import { describe, it, expect, beforeEach } from 'vitest';
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

function makeDb() {
  const exec: any = {
    one: () => Promise.resolve({}),
    any: () => Promise.resolve([]),
    none: () => Promise.resolve(null),
    result: (_q: string, _v?: unknown, cb?: (r: any) => unknown) =>
      Promise.resolve(cb ? cb({ rowCount: 1, rows: [{}] }) : { rowCount: 1 }),
  };
  exec.tx = async (fn: (t: any) => unknown) => fn(exec);
  return exec;
}

const schema: TableSchema = {
  dbSchema: 'public',
  table: 'accounts',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'email', type: 'text', notNull: true },
    { name: 'seats', type: 'integer' },
  ],
  constraints: { primaryKey: ['id'] },
};

const VALID = {
  id: 'aaaaaaaa-1111-4222-8333-444444444444',
  email: 'a@b.com',
  seats: 3,
};

describe('upsert input validation', () => {
  let model: TableModel;

  beforeEach(() => {
    columnSetCache.clear();
    model = new TableModel(makeDb(), pgp, schema);
  });

  it('accepts a valid DTO', async () => {
    // Negative control: the guard must not fire on good input.
    await expect(model.upsert({ ...VALID }, ['id'])).resolves.toBeDefined();
  });

  it('rejects a DTO whose column fails its type validator', async () => {
    await expect(
      model.upsert({ ...VALID, seats: 'three' } as never, ['id'])
    ).rejects.toThrow('Upsert DTO validation failed');
  });

  it('rejects a malformed uuid', async () => {
    await expect(
      model.upsert({ ...VALID, id: 'not-a-uuid' }, ['id'])
    ).rejects.toThrow('Upsert DTO validation failed');
  });

  it('applies the automatic email check on upsert', async () => {
    await expect(
      model.upsert({ ...VALID, email: 'not-an-email' }, ['id'])
    ).rejects.toThrow('Upsert DTO validation failed');
  });

  it('reports the failure as a Zod issue array in cause', async () => {
    // zod 4 renamed ZodError.errors to .issues; a miss here leaves cause
    // undefined, which is how the accessor change would have shipped silently.
    const err = await model
      .upsert({ ...VALID, seats: 'three' } as never, ['id'])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SchemaDefinitionError);
    const cause = (err as SchemaDefinitionError).cause;
    expect(Array.isArray(cause)).toBe(true);
    expect((cause as { path: string[] }[])[0]?.path).toEqual(['seats']);
  });
});

describe('bulkUpsert input validation', () => {
  let model: TableModel;

  beforeEach(() => {
    columnSetCache.clear();
    model = new TableModel(makeDb(), pgp, schema);
  });

  it('accepts valid records', async () => {
    await expect(
      model.bulkUpsert(
        [VALID, { ...VALID, id: 'bbbbbbbb-1111-4222-8333-444444444444' }],
        ['id']
      )
    ).resolves.toBeDefined();
  });

  it('rejects the batch when any record is invalid', async () => {
    await expect(
      model.bulkUpsert(
        [
          VALID,
          {
            ...VALID,
            id: 'bbbbbbbb-1111-4222-8333-444444444444',
            seats: 'three',
          } as never,
        ],
        ['id']
      )
    ).rejects.toThrow('Bulk Upsert DTO validation failed');
  });

  it('names the offending record index in the issue path', async () => {
    // Arrays validate through validator.array(), so the index is in the path —
    // without it a failed batch gives no way to find the bad row.
    const err = await model
      .bulkUpsert(
        [
          VALID,
          {
            ...VALID,
            id: 'bbbbbbbb-1111-4222-8333-444444444444',
            seats: 'three',
          } as never,
        ],
        ['id']
      )
      .catch((e: unknown) => e);

    const cause = (err as SchemaDefinitionError).cause as {
      path: (string | number)[];
    }[];
    expect(Array.isArray(cause)).toBe(true);
    expect(cause[0]?.path).toEqual([1, 'seats']);
  });
});
