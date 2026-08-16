/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// The cache key was `${table}::${dbSchema}` alone. It carried no information
// about the definition behind those names, so two schemas describing the same
// qualified table shared one entry and whichever was constructed first won for
// the lifetime of that entry (1 hour, or until eviction at 20k entries).
//
// It needs two definitions of one qualified table name in a single process,
// which happens in test suites building fixture variants, in codebases carrying
// a legacy and a current model for one table mid-migration, and anywhere a
// second pg-promise instance is in play.

import { describe, it, expect, beforeEach } from 'vitest';
import pgPromise from 'pg-promise';
import {
  createColumnSet,
  columnSetCache,
} from '../../src/utils/schemaBuilder.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

function schemaWith(
  columns: TableSchema['columns'],
  overrides: Partial<TableSchema> = {}
): TableSchema {
  return {
    dbSchema: 'public',
    table: 'things',
    hasAuditFields: false,
    columns,
    constraints: { primaryKey: ['id'] },
    ...overrides,
  };
}

/** The column names a ColumnSet actually carries, for comparison. */
function namesOf(cs: { columns: { name: string }[] }): string[] {
  return cs.columns.map(c => c.name).sort();
}

beforeEach(() => {
  columnSetCache.clear();
});

describe('ColumnSet cache key', () => {
  it('does not share an entry between two definitions of one table', () => {
    // The original repro: same dbSchema.table, different columns.
    const first = createColumnSet(
      schemaWith([
        { name: 'id', type: 'uuid', notNull: true },
        { name: 'a', type: 'text' },
      ]),
      pgp
    );
    const second = createColumnSet(
      schemaWith([
        { name: 'id', type: 'uuid', notNull: true },
        { name: 'b', type: 'text' },
      ]),
      pgp
    );

    expect(namesOf(first.things as never)).toEqual(['a', 'id']);
    expect(namesOf(second.things as never)).toEqual(['b', 'id']);
  });

  it('still caches when the same schema object is reused', () => {
    // The hot path: one schema object across many forSchema() calls. Reference
    // identity is preserved, so the fingerprint matches and the entry is hit.
    const schema = schemaWith([{ name: 'id', type: 'uuid', notNull: true }]);
    expect(createColumnSet(schema, pgp)).toBe(createColumnSet(schema, pgp));
  });

  it('separates entries differing only in colProps', () => {
    const withCast = createColumnSet(
      schemaWith([
        { name: 'id', type: 'uuid', notNull: true },
        { name: 'tags', type: 'uuid[]', colProps: { cast: 'uuid[]' } },
      ]),
      pgp
    );
    const withoutCast = createColumnSet(
      schemaWith([
        { name: 'id', type: 'uuid', notNull: true },
        { name: 'tags', type: 'uuid[]' },
      ]),
      pgp
    );

    const cast = (cs: never) =>
      (cs as { columns: { name: string; cast?: string }[] }).columns.find(
        c => c.name === 'tags'
      )?.cast;

    expect(cast(withCast.things as never)).toBe('uuid[]');
    expect(cast(withoutCast.things as never)).toBeUndefined();
  });

  it('separates entries differing only in a colProps function', () => {
    // skip and init are functions and cannot be hashed structurally, so they
    // fall back to reference identity. Two distinct functions must not collide.
    const build = (skip: () => boolean) =>
      createColumnSet(
        schemaWith([
          { name: 'id', type: 'uuid', notNull: true },
          { name: 'note', type: 'text', colProps: { skip } },
        ]),
        pgp
      );

    expect(build(() => true)).not.toBe(build(() => false));
  });

  it('separates entries differing only in the audit configuration', () => {
    const audited = createColumnSet(
      schemaWith(
        [
          { name: 'id', type: 'uuid', notNull: true },
          { name: 'created_at', type: 'timestamptz' },
          { name: 'created_by', type: 'varchar(50)' },
          { name: 'updated_at', type: 'timestamptz' },
          { name: 'updated_by', type: 'varchar(50)' },
        ],
        { hasAuditFields: true }
      ),
      pgp
    );
    const plain = createColumnSet(
      schemaWith([{ name: 'id', type: 'uuid', notNull: true }]),
      pgp
    );

    expect(audited).not.toBe(plain);
    expect(namesOf(audited.insert as never)).toContain('created_by');
    expect(namesOf(plain.insert as never)).not.toContain('created_by');
  });

  it('separates entries differing only in the primary key', () => {
    // createColumnSet reads primaryKey to decide which columns are skipped as
    // auto-generated, so it belongs in the fingerprint.
    const columns: TableSchema['columns'] = [
      { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()' },
      { name: 'code', type: 'text', notNull: true },
    ];

    const keyedOnId = createColumnSet(
      schemaWith(columns, { constraints: { primaryKey: ['id'] } }),
      pgp
    );
    const keyedOnCode = createColumnSet(
      schemaWith(columns, { constraints: { primaryKey: ['code'] } }),
      pgp
    );

    expect(keyedOnId).not.toBe(keyedOnCode);
  });

  it('does not share entries across pg-promise instances', () => {
    // ColumnSet instances are bound to the pgp that built them.
    const other = pgPromise({ capSQL: true });
    const schema = schemaWith([{ name: 'id', type: 'uuid', notNull: true }]);

    expect(createColumnSet(schema, pgp)).not.toBe(
      createColumnSet(schema, other)
    );
  });
});
