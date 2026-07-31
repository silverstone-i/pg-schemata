/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Real pg-promise, no schemaBuilder mocks: these tests assert that finished
// statements are never run through the formatter a second time. The failure
// mode is ordinary stored text containing a $n token ("refund $1 processed")
// being treated as a placeholder (issues 14, N4, N5).
import pgPromise from 'pg-promise';
import type { IMain } from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const pgp = pgPromise({});
const DANGEROUS = 'refund $1 processed';

function makeCapturingDb() {
  const calls: any[] = [];
  const exec: any = {
    calls,
    one: (q: string, v?: unknown) => {
      calls.push([q, v]);
      return Promise.resolve({});
    },
    any: (q: string, v?: unknown) => {
      calls.push([q, v]);
      return Promise.resolve([]);
    },
    none: (q: string, v?: unknown) => {
      calls.push([q, v]);
      return Promise.resolve(null);
    },
    result: (q: string, v?: unknown, cb?: (r: any) => unknown) => {
      calls.push([q, v]);
      return Promise.resolve(cb ? cb({ rowCount: 1 }) : { rowCount: 1 });
    },
    batch: (promises: Promise<unknown>[]) => Promise.all(promises),
  };
  exec.tx = async (fn: (t: any) => unknown) => fn(exec);
  return exec;
}

const schema: TableSchema = {
  dbSchema: 'public',
  table: 'fmt_notes',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', notNull: true },
    { name: 'note', type: 'text', notNull: true },
  ],
  constraints: { primaryKey: ['id'] },
};

describe('no second format pass over finished statements', () => {
  let db: any;
  let model: any;

  beforeEach(() => {
    columnSetCache.clear();
    db = makeCapturingDb();
    model = new TableModel(db, pgp, schema);
  });

  it('bulkUpdate inlines the id once and passes no values (14)', async () => {
    await model.bulkUpdate([
      { id: 'aaaaaaaa-1111-2222-3333-444444444444', note: DANGEROUS },
    ]);

    const [query, values] = db.calls[0];
    expect(query).toContain("'refund $1 processed'");
    expect(query).toContain(
      "WHERE id = 'aaaaaaaa-1111-2222-3333-444444444444'"
    );
    expect(values).toBeUndefined();
  });

  it('updateWhere formats the WHERE before concatenating (N4)', async () => {
    await model.updateWhere([{ id: 'aaaaaaaa-1111-2222-3333-444444444444' }], {
      note: DANGEROUS,
    });

    const [query, values] = db.calls[0];
    expect(query).toContain("'refund $1 processed'");
    expect(query).toContain('"id" = \'aaaaaaaa-1111-2222-3333-444444444444\'');
    expect(values).toBeUndefined();
  });

  it('bulkInsert passes no values for its finished statement (N5)', async () => {
    await model.bulkInsert([{ note: DANGEROUS }]);

    const [query, values] = db.calls[0];
    expect(query).toContain("'refund $1 processed'");
    expect(values).toBeUndefined();
  });

  it('bulkUpsert passes no values for its finished statement (N5)', async () => {
    await model.bulkUpsert(
      [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', note: DANGEROUS }],
      ['id']
    );

    const [query, values] = db.calls[0];
    expect(query).toContain("'refund $1 processed'");
    expect(values).toBeUndefined();
  });

  it('reuses validators across instances built from the same schema literal (N8)', () => {
    const other = new TableModel(makeCapturingDb(), pgp, schema);
    expect(other._schema.validators).toBe(model._schema.validators);
    expect(other._schema.validators!.insertValidator).toBeDefined();
  });

  it('treats returning: [] the same as returning: null (PR #10 review)', async () => {
    const insertCount = await model.bulkInsert([{ note: 'a' }], []);
    const updateCount = await model.bulkUpdate(
      [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', note: 'b' }],
      []
    );
    const upsertCount = await model.bulkUpsert(
      [{ id: 'aaaaaaaa-1111-2222-3333-444444444444', note: 'c' }],
      ['id'],
      null,
      []
    );

    for (const [query] of db.calls) {
      expect(query).not.toContain('RETURNING');
    }
    expect(insertCount).toBe(1);
    expect(Array.isArray(updateCount)).toBe(true); // batch of rowCounts
    expect(upsertCount).toBe(1);
  });

  it('names the offending index when bulkInsert records have mismatched keys (suggestion 8)', async () => {
    await expect(
      model.bulkInsert([
        { note: 'a' },
        { note: 'b', id: 'aaaaaaaa-1111-2222-3333-444444444444' },
      ])
    ).rejects.toThrow(
      'Record at index 1 has columns [id, note], but record 0 has [note]'
    );
    expect(db.calls).toHaveLength(0);
  });

  it('rejects unknown identifiers in returning and conflict columns (issues 5, 6)', async () => {
    await expect(
      model.bulkInsert([{ note: 'x' }], ['note; DROP TABLE y; --'])
    ).rejects.toThrow('Unknown column: note; DROP TABLE y; --');
    await expect(
      model.upsert({ id: 'aaaaaaaa-1111-2222-3333-444444444444', note: 'x' }, [
        'id) DO NOTHING; DROP TABLE x; --',
      ])
    ).rejects.toThrow('Unknown column');
    expect(db.calls).toHaveLength(0);
  });

  it('escapes valid returning columns', async () => {
    await model.bulkInsert([{ note: 'x' }], ['note']);
    expect(db.calls[0][0]).toContain('RETURNING "note"');
  });

  it('routes mutating methods through options.tx when supplied (issue 12)', async () => {
    const txDb = makeCapturingDb();

    await model.insert({ note: 'a' }, { tx: txDb });
    await model.update(
      'aaaaaaaa-1111-2222-3333-444444444444',
      { note: 'b' },
      { tx: txDb }
    );
    await model.deleteWhere([{ note: 'a' }], { tx: txDb });
    await model.bulkInsert([{ note: 'c' }], null, { tx: txDb });

    expect(txDb.calls.length).toBe(4);
    expect(db.calls.length).toBe(0);
  });

  it('honors the deprecated this.tx on single-row methods too (issue 12)', async () => {
    const txDb = makeCapturingDb();
    model.tx = txDb;

    await model.insert({ note: 'a' });
    await model.delete('aaaaaaaa-1111-2222-3333-444444444444');

    expect(txDb.calls.length).toBe(2);
    expect(db.calls.length).toBe(0);
  });

  it('bulkUpdate reuses one ColumnSet across records with the same keys', async () => {
    const spy = [];
    const RealColumnSet = pgp.helpers.ColumnSet;
    class CountingColumnSet extends RealColumnSet {
      constructor(...args: ConstructorParameters<typeof RealColumnSet>) {
        spy.push(1);
        super(...args);
      }
    }
    const countingPgp = {
      ...pgp,
      helpers: Object.assign(Object.create(pgp.helpers), {
        ColumnSet: CountingColumnSet,
      }),
    } as unknown as IMain;
    const counting = new TableModel(db, countingPgp, {
      ...schema,
      table: 'fmt_notes_cs',
    });
    spy.length = 0; // discard constructor-time ColumnSet builds

    await counting.bulkUpdate([
      { id: 'aaaaaaaa-1111-2222-3333-444444444401', note: 'a' },
      { id: 'aaaaaaaa-1111-2222-3333-444444444402', note: 'b' },
      { id: 'aaaaaaaa-1111-2222-3333-444444444403', note: 'c' },
    ]);

    expect(spy.length).toBe(1);
  });

  it('_columns rejects non-array input with a SchemaDefinitionError (PR #10 review)', () => {
    expect(() => model._columns('note')).toThrow(
      'Expected an array of column names, got string'
    );
    expect(() => model._columns(undefined)).toThrow(
      'Expected an array of column names, got undefined'
    );
  });
});
