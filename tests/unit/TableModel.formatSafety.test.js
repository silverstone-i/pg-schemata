import { describe, it, expect, beforeEach } from 'vitest';

// Real pg-promise, no schemaBuilder mocks: these tests assert that finished
// statements are never run through the formatter a second time. The failure
// mode is ordinary stored text containing a $n token ("refund $1 processed")
// being treated as a placeholder (issues 14, N4, N5).
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';

const pgp = pgPromise({});
const DANGEROUS = 'refund $1 processed';

function makeCapturingDb() {
  const calls = [];
  const exec = {
    calls,
    one: (q, v) => { calls.push([q, v]); return Promise.resolve({}); },
    any: (q, v) => { calls.push([q, v]); return Promise.resolve([]); },
    none: (q, v) => { calls.push([q, v]); return Promise.resolve(null); },
    result: (q, v, cb) => { calls.push([q, v]); return Promise.resolve(cb ? cb({ rowCount: 1 }) : { rowCount: 1 }); },
    batch: promises => Promise.all(promises),
  };
  exec.tx = async fn => fn(exec);
  return exec;
}

const schema = {
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
  let db;
  let model;

  beforeEach(() => {
    columnSetCache.clear();
    db = makeCapturingDb();
    model = new TableModel(db, pgp, schema);
  });

  it('bulkUpdate inlines the id once and passes no values (14)', async () => {
    await model.bulkUpdate([{ id: 'aaaaaaaa-1111-2222-3333-444444444444', note: DANGEROUS }]);

    const [query, values] = db.calls[0];
    expect(query).toContain("'refund $1 processed'");
    expect(query).toContain("WHERE id = 'aaaaaaaa-1111-2222-3333-444444444444'");
    expect(values).toBeUndefined();
  });

  it('updateWhere formats the WHERE before concatenating (N4)', async () => {
    await model.updateWhere([{ id: 'aaaaaaaa-1111-2222-3333-444444444444' }], { note: DANGEROUS });

    const [query, values] = db.calls[0];
    expect(query).toContain("'refund $1 processed'");
    expect(query).toContain('"id" = \'aaaaaaaa-1111-2222-3333-444444444444\'');
    expect(values).toBeUndefined();
  });

  it('bulkUpdate reuses one ColumnSet across records with the same keys', async () => {
    const spy = [];
    const RealColumnSet = pgp.helpers.ColumnSet;
    class CountingColumnSet extends RealColumnSet {
      constructor(...args) { spy.push(1); super(...args); }
    }
    const countingPgp = { ...pgp, helpers: Object.assign(Object.create(pgp.helpers), { ColumnSet: CountingColumnSet }) };
    const counting = new TableModel(db, countingPgp, { ...schema, table: 'fmt_notes_cs' });
    spy.length = 0; // discard constructor-time ColumnSet builds

    await counting.bulkUpdate([
      { id: 'aaaaaaaa-1111-2222-3333-444444444401', note: 'a' },
      { id: 'aaaaaaaa-1111-2222-3333-444444444402', note: 'b' },
      { id: 'aaaaaaaa-1111-2222-3333-444444444403', note: 'c' },
    ]);

    expect(spy.length).toBe(1);
  });
});
