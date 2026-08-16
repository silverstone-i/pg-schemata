/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// constraints.primaryKey is typed string[] and generates a PRIMARY KEY of any
// arity, but every row-targeting method emitted `WHERE id = $1` against a column
// literally named `id`. A table keyed on `code`, or on two columns, got correct
// DDL and silently wrong targeting — bulkUpdate most clearly, since it read the
// declared key for validation and then matched on `id` anyway.
//
// Real pg-promise, not a mocked one: the whole assertion is about the SQL that
// comes out, so a stubbed as.format would test nothing.

import { describe, it, expect, beforeEach } from 'vitest';
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import QueryModel from '../../src/QueryModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import type { TableSchema } from '../../src/schemaTypes.js';

const pgp = pgPromise({});

function makeDb() {
  const calls: string[] = [];
  const exec: any = {
    calls,
    result: (q: string, _v?: unknown, cb?: (r: any) => unknown) => {
      calls.push(q);
      return Promise.resolve(
        cb ? cb({ rowCount: 1, rows: [{}] }) : { rowCount: 1 }
      );
    },
    any: (q: string) => {
      calls.push(q);
      return Promise.resolve([{}]);
    },
    one: (q: string) => {
      calls.push(q);
      return Promise.resolve({ exists: true });
    },
  };
  // bulkUpdate runs its statements through t.batch inside a transaction.
  exec.batch = (items: unknown[]) => Promise.all(items);
  exec.none = (q: string) => {
    calls.push(q);
    return Promise.resolve(null);
  };
  exec.tx = async (fn: (t: any) => unknown) => fn(exec);
  return exec;
}

/** Keyed on `code`, not `id` — the renamed-key case. */
const renamedKey: TableSchema = {
  dbSchema: 'public',
  table: 'coupons',
  hasAuditFields: false,
  columns: [
    { name: 'code', type: 'text', notNull: true },
    { name: 'label', type: 'text' },
  ],
  constraints: { primaryKey: ['code'] },
};

/** Two-column key — the composite case. */
const compositeKey: TableSchema = {
  dbSchema: 'public',
  table: 'memberships',
  hasAuditFields: false,
  columns: [
    { name: 'tenant_id', type: 'uuid', notNull: true },
    { name: 'user_id', type: 'uuid', notNull: true },
    { name: 'role', type: 'text' },
  ],
  constraints: { primaryKey: ['tenant_id', 'user_id'] },
};

/** Composite key plus soft delete, for the purge path. */
const compositeSoftDelete: TableSchema = {
  ...compositeKey,
  table: 'soft_memberships',
  softDelete: true,
  columns: [
    ...compositeKey.columns,
    { name: 'deactivated_at', type: 'timestamptz' },
  ],
};

const T = '11111111-2222-4333-8444-555555555555';
const U = '99999999-8888-4777-8666-555555555555';

beforeEach(() => {
  columnSetCache.clear();
});

describe('single-column key that is not named id', () => {
  let db: ReturnType<typeof makeDb>;
  let model: TableModel;

  beforeEach(() => {
    db = makeDb();
    model = new TableModel(db, pgp, renamedKey);
  });

  it('findById targets the declared column', async () => {
    await model.findById('SAVE10');
    expect(db.calls[0]).toContain('"code" = ');
    expect(db.calls[0]).not.toContain('"id"');
  });

  it('update targets the declared column', async () => {
    await model.update('SAVE10', { label: 'Ten off' } as never);
    expect(db.calls[0]).toContain(`WHERE "code" = 'SAVE10'`);
  });

  it('delete targets the declared column', async () => {
    await model.delete('SAVE10');
    expect(db.calls[0]).toContain('"code" = ');
    expect(db.calls[0]).toMatch(/^DELETE FROM/);
  });

  it('bulkUpdate targets the declared column and keeps it out of SET', async () => {
    // It previously read `dto.id` — undefined here — while validating against
    // the declared key.
    await model.bulkUpdate([{ code: 'SAVE10', label: 'Ten off' }] as never);
    const sql = db.calls.join('\n');
    expect(sql).toContain(`WHERE "code" = 'SAVE10'`);
    expect(sql).toContain('"label"=');
    expect(sql).not.toMatch(/set[^]*"code"=/i);
  });
});

describe('composite key', () => {
  let db: ReturnType<typeof makeDb>;
  let model: TableModel;

  beforeEach(() => {
    db = makeDb();
    model = new TableModel(db, pgp, compositeKey);
  });

  it('findById accepts an object and ANDs both columns', async () => {
    await model.findById({ tenant_id: T, user_id: U });
    expect(db.calls[0]).toContain('"tenant_id"');
    expect(db.calls[0]).toContain('"user_id"');
  });

  it('update ANDs both columns', async () => {
    await model.update({ tenant_id: T, user_id: U }, {
      role: 'admin',
    } as never);
    expect(db.calls[0]).toContain(`WHERE "tenant_id" = '${T}'`);
    expect(db.calls[0]).toContain(`"user_id" = '${U}'`);
  });

  it('delete ANDs both columns', async () => {
    await model.delete({ tenant_id: T, user_id: U });
    expect(db.calls[0]).toContain('"tenant_id"');
    expect(db.calls[0]).toContain('"user_id"');
  });

  it('rejects a scalar, naming the columns to pass instead', async () => {
    await expect(model.findById(T)).rejects.toThrow(
      /composite primary key \[tenant_id, user_id\]/
    );
  });

  it('rejects a key missing a column', async () => {
    await expect(model.findById({ tenant_id: T })).rejects.toThrow(
      /missing: user_id/
    );
  });

  it('rejects a key carrying an unknown column', async () => {
    await expect(
      model.findById({ tenant_id: T, user_id: U, role: 'x' })
    ).rejects.toThrow(/unexpected: role/);
  });

  it('rejects an invalid value for a key column', async () => {
    await expect(model.findById({ tenant_id: T, user_id: '' })).rejects.toThrow(
      /Invalid value for primary key column "user_id"/
    );
  });

  it('bulkUpdate requires every key column on each record', async () => {
    await expect(
      model.bulkUpdate([{ tenant_id: T, role: 'admin' }] as never)
    ).rejects.toThrow(/missing primary key column "user_id"/);
  });
});

describe('purgeSoftDeleteById', () => {
  // The eighth by-id method, and the one missed when the other seven moved off
  // the hardcoded `id`. It built `[{ id }]` directly.
  it('targets a single-column key that is not named id', async () => {
    const db = makeDb();
    const model = new TableModel(db, pgp, {
      ...renamedKey,
      table: 'soft_coupons',
      softDelete: true,
      columns: [
        ...renamedKey.columns,
        { name: 'deactivated_at', type: 'timestamptz' },
      ],
    });

    await model.purgeSoftDeleteById('SAVE10');

    const sql = db.calls[0]!;
    expect(sql).toMatch(/^DELETE FROM/);
    expect(sql).toContain('"code"');
    expect(sql).not.toContain('"id"');
    // The purge path only ever removes already-deactivated rows.
    expect(sql).toContain('"deactivated_at" IS NOT NULL');
  });

  it('ANDs every column of a composite key', async () => {
    const db = makeDb();
    const model = new TableModel(db, pgp, compositeSoftDelete);

    await model.purgeSoftDeleteById({ tenant_id: T, user_id: U });

    const sql = db.calls[0]!;
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"user_id"');
  });

  it('rejects a scalar against a composite key', async () => {
    const model = new TableModel(makeDb(), pgp, compositeSoftDelete);
    await expect(model.purgeSoftDeleteById(T)).rejects.toThrow(
      /composite primary key/
    );
  });

  it('still rejects when soft delete is disabled', async () => {
    // Checked before the key is resolved, so the message stays the specific one.
    const model = new TableModel(makeDb(), pgp, compositeKey);
    await expect(
      model.purgeSoftDeleteById({ tenant_id: T, user_id: U })
    ).rejects.toThrow(/Soft delete is not enabled/);
  });
});

describe('schema validation at construction', () => {
  it('rejects a non-array primaryKey', () => {
    // A bare string was harmless while nothing iterated it; it is now the
    // source of the key columns, and iterating a string yields characters.
    expect(
      () =>
        new TableModel(makeDb(), pgp, {
          ...renamedKey,
          constraints: { primaryKey: 'code' },
        } as never)
    ).toThrow(/must be an array of column names/);
  });

  it('rejects a non-array primaryKey on a bare QueryModel too', () => {
    // QueryModel is exported and instantiable on its own, and the check used to
    // live in TableModel's constructor. Identifier validation walks the key with
    // for…of, which accepts a string happily — so construction succeeded and the
    // first by-id call died with `columns.filter is not a function`.
    expect(
      () =>
        new QueryModel(makeDb(), pgp, {
          ...renamedKey,
          constraints: { primaryKey: 'code' },
        } as never)
    ).toThrow(/must be an array of column names/);
  });

  it('rejects an empty primaryKey', () => {
    expect(
      () =>
        new TableModel(makeDb(), pgp, {
          ...renamedKey,
          constraints: { primaryKey: [] },
        })
    ).toThrow(/at least one column/);
  });

  it('still rejects a missing primaryKey', () => {
    expect(
      () => new TableModel(makeDb(), pgp, { ...renamedKey, constraints: {} })
    ).toThrow(SchemaDefinitionError);
  });
});

describe('the ordinary id case is unchanged', () => {
  const plain: TableSchema = {
    dbSchema: 'public',
    table: 'widgets',
    hasAuditFields: false,
    columns: [
      { name: 'id', type: 'uuid', notNull: true },
      { name: 'label', type: 'text' },
    ],
    constraints: { primaryKey: ['id'] },
  };

  it('accepts a scalar and targets id', async () => {
    const db = makeDb();
    const model = new TableModel(db, pgp, plain);
    await model.update(T, { label: 'x' } as never);
    expect(db.calls[0]).toContain(`WHERE "id" = '${T}'`);
  });

  it('also accepts the object form', async () => {
    const db = makeDb();
    const model = new TableModel(db, pgp, plain);
    await model.update({ id: T }, { label: 'x' } as never);
    expect(db.calls[0]).toContain(`WHERE "id" = '${T}'`);
  });
});
