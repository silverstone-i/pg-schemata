/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { z } from 'zod';
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import {
  typesCoverageSchema,
  constraintCoverageSchema,
} from '../fixtures/consumerSchemas.js';
import type { DbConnection } from '../../src/schemaTypes.js';

// Real pgp with a stub db: the point of this suite is that the *real*
// validators generate and behave, so stubbing schemaBuilder away would test
// nothing.
const pgp = pgPromise({});
const stubDb = {
  one: async () => ({}),
  any: async () => [],
  oneOrNone: async () => null,
} as unknown as DbConnection;

describe('consumer schema coverage', () => {
  beforeEach(() => {
    columnSetCache.clear();
  });

  it('constructs a TableModel for both schemas', () => {
    // The regression net for the type-mapping rewrite: this fails on 2.0.0
    // at `time`, `text[]` and `uuid[]`, and because validators are generated
    // in the constructor it fails at app boot rather than at first write.
    expect(
      () => new TableModel(stubDb, pgp, typesCoverageSchema)
    ).not.toThrow();
    expect(
      () => new TableModel(stubDb, pgp, constraintCoverageSchema)
    ).not.toThrow();
  });

  describe('generated validators', () => {
    let base: z.ZodType;

    beforeEach(() => {
      columnSetCache.clear();
      const model = new TableModel(stubDb, pgp, typesCoverageSchema);
      base = model._schema.validators!.baseValidator;
    });

    /** Parses a single column value against the base validator. */
    const accepts = (column: string, value: unknown): boolean => {
      const result = base.safeParse({ [column]: value });
      if (result.success) return true;
      // The row is partial, so only failures naming this column count.
      return !result.error.issues.some(i => i.path[0] === column);
    };

    it('accepts representative values for every mapped type', () => {
      expect(accepts('id', '550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(accepts('title', 'a title')).toBe(true);
      expect(accepts('small_count', 1)).toBe(true);
      expect(accepts('big_count', 2)).toBe(true);
      expect(accepts('amount', '12.34')).toBe(true);
      expect(accepts('payload', { a: 1 })).toBe(true);
      expect(accepts('is_active', true)).toBe(true);
      expect(accepts('rank', 3)).toBe(true);
      expect(accepts('occurred_at', '2020-01-01T00:00:00Z')).toBe(true);
      expect(accepts('occurred_on', '2020-01-01')).toBe(true);
      expect(accepts('starts_at', '07:00:00')).toBe(true);
      expect(accepts('tags', ['a', 'b'])).toBe(true);
      expect(
        accepts('related_ids', ['550e8400-e29b-41d4-a716-446655440000'])
      ).toBe(true);
      expect(accepts('code', '0123456789')).toBe(true);
      expect(accepts('sequence_no', '9007199254740993')).toBe(true);
    });

    it('rejects wrong-typed values', () => {
      expect(accepts('id', 'not-a-uuid')).toBe(false);
      expect(accepts('title', 42)).toBe(false);
      expect(accepts('small_count', 'x')).toBe(false);
      expect(accepts('big_count', 1.5)).toBe(false);
      expect(accepts('is_active', 'yes')).toBe(false);
      expect(accepts('occurred_at', 'garbage')).toBe(false);
    });

    it('maps int and integer alike', () => {
      expect(accepts('small_count', 7)).toBe(true);
      expect(accepts('big_count', 7)).toBe(true);
      expect(accepts('small_count', 7.5)).toBe(false);
      expect(accepts('big_count', 7.5)).toBe(false);
    });

    it('accepts both 07:00:00 and 24:00:00 for time', () => {
      expect(accepts('starts_at', '07:00:00')).toBe(true);
      expect(accepts('starts_at', '24:00:00')).toBe(true);
      expect(accepts('starts_at', '24:00:01')).toBe(false);
    });

    it('accepts the all-F GUID (z.guid(), not z.uuid())', () => {
      expect(accepts('id', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toBe(true);
    });

    it('validates text[] and uuid[] as arrays', () => {
      expect(accepts('tags', ['a', 'b'])).toBe(true);
      expect(accepts('tags', 'a')).toBe(false);
      expect(accepts('related_ids', ['not-a-guid'])).toBe(false);
    });

    it('enforces the varchar(10) length', () => {
      expect(accepts('code', '0123456789')).toBe(true);
      expect(accepts('code', '01234567890')).toBe(false);
    });

    it('accepts the numeric string pg returns', () => {
      expect(accepts('amount', '12.34')).toBe(true);
      expect(accepts('amount', 12.34)).toBe(true);
      expect(accepts('amount', 'abc')).toBe(false);
    });

    it('includes the configured audit columns', () => {
      const model = new TableModel(stubDb, pgp, typesCoverageSchema);
      const names = model.schema.columns.map(c => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'created_at',
          'created_by',
          'updated_at',
          'updated_by',
        ])
      );
    });
  });
});
