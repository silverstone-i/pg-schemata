/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Real pg-promise, no schemaBuilder mocks: the assertion is about the SQL
// pg-promise emits for a column carrying colProps, so a mocked ColumnSet would
// test nothing. Only insert() uses the cached ColumnSet; every other write path
// builds one per call from the DTO's keys, and building those from bare name
// strings discarded colProps entirely — a `uuid[]` column reached Postgres as a
// text[] literal on all of them.
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

function makeCapturingDb() {
  const calls: any[] = [];
  const exec: any = {
    calls,
    one: (q: string) => {
      calls.push(q);
      return Promise.resolve({});
    },
    any: (q: string) => {
      calls.push(q);
      return Promise.resolve([]);
    },
    none: (q: string) => {
      calls.push(q);
      return Promise.resolve(null);
    },
    result: (q: string, _v?: unknown, cb?: (r: any) => unknown) => {
      calls.push(q);
      return Promise.resolve(cb ? cb({ rowCount: 1 }) : { rowCount: 1 });
    },
    batch: (promises: Promise<unknown>[]) => Promise.all(promises),
  };
  exec.tx = async (fn: (t: any) => unknown) => fn(exec);
  return exec;
}

const ID = 'aaaaaaaa-1111-4222-8333-444444444444';
const RELATED = ['bbbbbbbb-1111-4222-8333-444444444444'];

const schema: TableSchema = {
  dbSchema: 'public',
  table: 'cast_notes',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'note', type: 'text', notNull: true },
    {
      name: 'related_ids',
      type: 'uuid[]',
      colProps: { cast: 'uuid[]' },
    },
    { name: 'payload', type: 'jsonb', colProps: { mod: ':json' } },
  ],
  constraints: { primaryKey: ['id'] },
};

describe('colProps survive on every write path', () => {
  let db: any;
  let model: any;

  beforeEach(() => {
    columnSetCache.clear();
    db = makeCapturingDb();
    model = new TableModel(db, pgp, schema);
  });

  const row = () => ({ id: ID, note: 'n', related_ids: [...RELATED] });

  it('insert casts the array (cached ColumnSet, the path that always worked)', async () => {
    await model.insert(row());
    expect(db.calls.at(-1)).toContain('::uuid[]');
  });

  it('upsert casts the array', async () => {
    await model.upsert(row(), ['id']);
    expect(db.calls.at(-1)).toContain('::uuid[]');
  });

  it('bulkUpsert casts the array', async () => {
    await model.bulkUpsert([row()], ['id']);
    expect(db.calls.at(-1)).toContain('::uuid[]');
  });

  it('bulkInsert casts the array', async () => {
    await model.bulkInsert([row()]);
    expect(db.calls.at(-1)).toContain('::uuid[]');
  });

  it('updateWhere casts the array', async () => {
    await model.updateWhere({ id: ID }, { related_ids: [...RELATED] });
    expect(db.calls.at(-1)).toContain('::uuid[]');
  });

  it('bulkUpdate casts the array', async () => {
    await model.bulkUpdate([{ id: ID, related_ids: [...RELATED] }]);
    expect(db.calls.join('\n')).toContain('::uuid[]');
  });

  it('carries mod through a dynamic ColumnSet too', async () => {
    // `:json` is not new, but it rode on the same discarded colProps — the
    // cast fix is what made the gap visible.
    await model.updateWhere({ id: ID }, { payload: { a: 1 } });
    expect(db.calls.at(-1)).toContain('{"a":1}');
  });

  it('leaves a column without colProps alone', async () => {
    await model.updateWhere({ id: ID }, { note: 'plain' });
    expect(db.calls.at(-1)).not.toContain('::');
  });
});
