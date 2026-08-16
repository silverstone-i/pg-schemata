/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Real pg-promise, no schemaBuilder mocks: the whole assertion is about which
// columns appear in the emitted SET list, so a mocked ColumnSet would test
// nothing.
//
// update() used the cached `cs.update`, which covers every column in the table,
// and createColumnSet() gives each column a `def`. pg-promise therefore
// substituted a value for columns the DTO omitted instead of leaving them out,
// so a partial update overwrote every unmentioned column with null (or its
// declared SQL default). The library's own docs and touch() both pass partial
// DTOs, so this destroyed data on the documented happy path.
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

function makeCapturingDb() {
  const calls: string[] = [];
  const exec: any = {
    calls,
    result: (q: string, _v?: unknown, cb?: (r: any) => unknown) => {
      calls.push(q);
      return Promise.resolve(
        cb ? cb({ rowCount: 1, rows: [{}] }) : { rowCount: 1 }
      );
    },
  };
  exec.tx = async (fn: (t: any) => unknown) => fn(exec);
  return exec;
}

const ID = 'aaaaaaaa-1111-4222-8333-444444444444';

const schema: TableSchema = {
  dbSchema: 'public',
  table: 'periods',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'org_id', type: 'uuid', notNull: true },
    { name: 'name', type: 'text' },
    { name: 'start_date', type: 'date', notNull: true },
    // A column with a SQL default took the DEFAULT keyword rather than null,
    // which is just as destructive and harder to spot.
    { name: 'workflow_state', type: 'text', notNull: true, default: "'draft'" },
  ],
  constraints: { primaryKey: ['id'] },
};

const auditedSchema: TableSchema = {
  ...schema,
  table: 'audited_periods',
  hasAuditFields: { enabled: true },
};

describe('TableModel.update with a partial DTO', () => {
  beforeEach(() => columnSetCache.clear());

  it('sets only the columns present in the DTO', async () => {
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, schema);

    await model.update(ID, { name: 'After' });

    const sql = db.calls[0];
    expect(sql).toContain('"name"=\'After\'');
    // The regression: these were previously emitted as null / DEFAULT.
    expect(sql).not.toContain('"org_id"');
    expect(sql).not.toContain('"start_date"');
    expect(sql).not.toContain('"workflow_state"');
  });

  it('never emits a bare null for an omitted column', async () => {
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, schema);

    await model.update(ID, { name: 'After' });

    const setClause = db.calls[0].split(' WHERE ')[0];
    expect(setClause).not.toMatch(/=null/);
    expect(setClause).not.toMatch(/=DEFAULT/);
  });

  it('still scopes the update to the id', async () => {
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, schema);

    await model.update(ID, { name: 'After' });

    expect(db.calls[0]).toContain(`WHERE "id" = '${ID}'`);
    expect(db.calls[0]).toContain('RETURNING *');
  });

  it('bumps updated_at when audit fields are enabled', async () => {
    // A SQL DEFAULT only applies on INSERT, so updated_at has to be set
    // explicitly on every update — building the ColumnSet from DTO keys alone
    // would have silently dropped it.
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, auditedSchema);

    await model.update(ID, { name: 'After' });

    expect(db.calls[0]).toContain('"updated_at"=CURRENT_TIMESTAMP');
    expect(db.calls[0]).toContain('"name"=\'After\'');
    expect(db.calls[0]).not.toContain('"org_id"');
  });

  it('ignores a caller-supplied updated_at', async () => {
    // The column is emitted with mod '^' (raw), so inlining a JS Date would
    // produce `"updated_at"=1969-12-31T19:00:00.000-05:00` — invalid SQL. The
    // library owns the column whenever audit fields are enabled.
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, auditedSchema);

    await model.update(ID, { name: 'After', updated_at: new Date(0) } as any);

    const occurrences = db.calls[0].match(/"updated_at"=/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(db.calls[0]).toContain('"updated_at"=CURRENT_TIMESTAMP');
    expect(db.calls[0]).not.toContain('1969');
  });

  it('rejects a DTO that is empty only after sanitization', async () => {
    // The emptiness check runs on the raw DTO, and the update validator strips
    // unknown keys rather than rejecting them — so a DTO carrying only unknown
    // or immutable columns reached the ColumnSet with no columns at all and
    // failed inside pg-promise, two frames from anything naming the schema.
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, {
      ...schema,
      table: 'immutable_periods',
      columns: [
        { name: 'id', type: 'uuid', notNull: true, immutable: true },
        { name: 'name', type: 'text' },
      ],
    });

    await expect(model.update(ID, { id: ID } as any)).rejects.toThrow(
      /no writable columns/
    );
    expect(db.calls).toHaveLength(0);
  });

  it('still accepts an empty DTO when audit fields carry the update', async () => {
    // The library-owned updated_at is a valid update on its own; the guard must
    // not take that path away — it is the one touch() uses with no actor.
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, auditedSchema);

    await model.update(ID, {} as any);

    expect(db.calls[0]).toContain('"updated_at"=CURRENT_TIMESTAMP');
  });

  it('updates a single column through touch()', async () => {
    // touch() routes through update() with only updated_by, which under the old
    // ColumnSet nulled the entire row.
    const db = makeCapturingDb();
    const model = new TableModel(db, pgp, auditedSchema);

    await model.touch(ID, '00000000-0000-0000-0000-000000000000');

    const setClause = db.calls[0].split(' WHERE ')[0];
    expect(setClause).toContain('"updated_by"');
    expect(setClause).not.toContain('"org_id"');
    expect(setClause).not.toMatch(/=null/);
  });
});
