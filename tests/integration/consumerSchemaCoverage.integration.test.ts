/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from '../helpers/integrationHarness.js';
import type { TestContext } from '../helpers/integrationHarness.js';
import { createTableSQL } from '../../src/utils/schemaBuilder.js';
import {
  typesCoverageSchema,
  constraintCoverageSchema,
} from '../fixtures/consumerSchemas.js';
import type TableModel from '../../src/TableModel.js';

// The only place that proves the round trip: that what pg actually returns
// matches what the generated validators expect. Everything else in this
// release is asserted against values we chose ourselves.

const GUID = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';
const OTHER_GUID = '550e8400-e29b-41d4-a716-446655440000';

describe('consumer schema coverage (integration)', () => {
  let ctx: TestContext['ctx'];
  let model: TableModel;
  let teardown: TestContext['teardown'];
  let dbSchema: string;

  beforeAll(async () => {
    // createTestContext builds exactly one table. Rather than calling it
    // twice — DB.init is a singleton, so the first teardown would end the
    // shared pool — the second table is created in the same throwaway schema,
    // whose generated name is read off the model.
    ({ ctx, model, teardown } = await createTestContext(typesCoverageSchema));
    dbSchema = model.schema.dbSchema;

    await ctx.db.none(
      createTableSQL({ ...constraintCoverageSchema, dbSchema })
    );
  });

  afterAll(async () => {
    await teardown();
  });

  describe('type round trip', () => {
    let row: Record<string, unknown>;

    beforeAll(async () => {
      // `id` carries colProps.cnd (mirroring the consumer), which keeps it out
      // of the insert column list, so the value comes from the column default.
      const inserted = (await model.insert({
        title: 'a title',
        small_count: 1,
        big_count: 2,
        amount: '12.34',
        payload: { a: 1 },
        is_active: true,
        rank: 3,
        occurred_at: '2020-01-01T00:00:00Z',
        occurred_on: '2020-01-01',
        starts_at: '07:00:00',
        tags: ['a', 'b'],
        // The all-F GUID lives here: Postgres stores it happily, and zod 4's
        // z.uuid() would reject it while z.guid() accepts it.
        related_ids: [GUID, OTHER_GUID],
        code: '0123456789',
        sequence_no: '9007199254740993',
      })) as Record<string, unknown>;

      row = await ctx.db.one(
        `SELECT * FROM "${dbSchema}"."types_coverage" WHERE id = $1`,
        [inserted.id]
      );
    });

    it('returns time as a string, not a Date', () => {
      // pg leaves OID 1083 unparsed, which is why the validator is a string
      // regex rather than z.coerce.date().
      expect(typeof row.starts_at).toBe('string');
      expect(row.starts_at).toBe('07:00:00');
    });

    it('returns text[] and uuid[] as JS arrays', () => {
      expect(Array.isArray(row.tags)).toBe(true);
      expect(row.tags).toEqual(['a', 'b']);
      expect(Array.isArray(row.related_ids)).toBe(true);
      expect(row.related_ids).toEqual([GUID.toLowerCase(), OTHER_GUID]);
    });

    it('returns numeric as a string', () => {
      // Precision preservation, same as int8 — which is why the numeric
      // validator accepts a string as well as a number.
      expect(typeof row.amount).toBe('string');
      expect(row.amount).toBe('12.34');
    });

    it('returns timestamptz and date as Date objects', () => {
      expect(row.occurred_at).toBeInstanceOf(Date);
      expect(row.occurred_on).toBeInstanceOf(Date);
    });

    it('stores the all-F GUID that z.uuid() would have rejected', () => {
      expect(row.related_ids).toContain(GUID.toLowerCase());
    });

    it('parses the row pg returned, unmodified', () => {
      // The whole point of the release: a row read straight back out of
      // Postgres must satisfy its own generated validator.
      const result = model._schema.validators!.baseValidator.safeParse(row);
      if (!result.success) {
        // Surface which column disagreed rather than a bare false.
        expect(result.error.issues).toEqual([]);
      }
      expect(result.success).toBe(true);
    });
  });

  describe('constraints and indexes', () => {
    it('creates every constraints.indexes entry', async () => {
      const indexes = await ctx.db.any(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = $1 AND tablename = 'constraint_coverage'`,
        [dbSchema]
      );

      const defs = indexes.map(i => i.indexdef).join('\n');

      // Plain, unique, and partial-unique.
      expect(defs).toMatch(/\(kind\)/);
      expect(defs).toMatch(/UNIQUE INDEX[^\n]*\(tenant_id, entity_id\)/);

      const partial = indexes.find(i => /WHERE/i.test(i.indexdef));
      expect(partial).toBeDefined();
      expect(partial!.indexdef).toMatch(/UNIQUE/);
      expect(partial!.indexdef).toMatch(/WHERE/);
    });

    it('creates the composite primary key and both unique forms', async () => {
      const constraints = await ctx.db.any(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = format('%I.%I', $1::text, 'constraint_coverage')::regclass`,
        [dbSchema]
      );

      const pk = constraints.find(c => c.contype === 'p');
      expect(pk).toBeDefined();
      expect(pk!.def).toMatch(/PRIMARY KEY \(tenant_id, entity_id, kind\)/);

      const uniques = constraints.filter(c => c.contype === 'u');
      expect(uniques.length).toBe(2);
      expect(uniques.some(u => /NULLS NOT DISTINCT/i.test(u.def))).toBe(true);
    });

    it('creates the three foreign keys with their delete actions', async () => {
      const fks = await ctx.db.any(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE contype = 'f'
            AND conrelid = format('%I.%I', $1::text, 'constraint_coverage')::regclass`,
        [dbSchema]
      );

      const defs = fks.map(f => f.def).join('\n');
      expect(fks.length).toBe(3);
      expect(defs).toMatch(/ON DELETE CASCADE/);
      expect(defs).toMatch(/ON DELETE SET NULL/);
      expect(defs).toMatch(/ON DELETE RESTRICT/);
    });

    it('creates the check constraint containing a cast', async () => {
      const checks = await ctx.db.any(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE contype = 'c'
            AND conrelid = format('%I.%I', $1::text, 'constraint_coverage')::regclass`,
        [dbSchema]
      );

      // PG rewrites `::text[]` into per-element casts inside the ARRAY
      // constructor, so assert on the stored form rather than the source.
      const defs = checks.map(c => c.def).join('\n');
      expect(defs).toMatch(/status = ANY \(ARRAY\[/);
      expect(defs).toMatch(/'draft'::text/);
      expect(defs).toMatch(/char_length/);
    });
  });
});
