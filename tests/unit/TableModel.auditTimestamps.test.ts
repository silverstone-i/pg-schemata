/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// docs/guide/audit-fields.md states that removeWhere and restoreWhere update
// updated_by and updated_at, and that update() populates the audit columns
// automatically. Three places did not deliver that, all with the same root
// cause: updated_at was treated as though it depended on knowing the actor.
//
//   - removeWhere / restoreWhere put `updated_at = NOW()` inside the
//     `if (actor != null)` branch, so an unconfigured resolver froze the
//     timestamp on every soft delete and restore.
//   - update() assigned the unresolved actor unconditionally, writing
//     `updated_by = null` and erasing whoever last touched the row.
//   - touch() sent an empty DTO when no actor resolved, which update() rejected
//     outright — so the one method whose entire job is bumping the timestamp
//     could not run without a resolver.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';
import {
  setAuditActorResolver,
  clearAuditActorResolver,
} from '../../src/auditActorResolver.js';
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
    any: (q: string) => {
      calls.push(q);
      return Promise.resolve([{}]);
    },
    one: (q: string) => {
      calls.push(q);
      return Promise.resolve({});
    },
  };
  exec.tx = async (fn: (t: any) => unknown) => fn(exec);
  return exec;
}

const ID = 'aaaaaaaa-1111-4222-8333-444444444444';

const auditedSoftDelete: TableSchema = {
  dbSchema: 'public',
  table: 'audited_rows',
  hasAuditFields: { enabled: true },
  softDelete: true,
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'label', type: 'text' },
    { name: 'deactivated_at', type: 'timestamptz' },
  ],
  constraints: { primaryKey: ['id'] },
};

const unaudited: TableSchema = {
  dbSchema: 'public',
  table: 'plain_rows',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'label', type: 'text' },
  ],
  constraints: { primaryKey: ['id'] },
};

describe('audit timestamps without an actor resolver', () => {
  let db: ReturnType<typeof makeCapturingDb>;
  let model: TableModel;

  beforeEach(() => {
    clearAuditActorResolver();
    columnSetCache.clear();
    db = makeCapturingDb();
    model = new TableModel(db, pgp, auditedSoftDelete);
  });

  it('removeWhere advances updated_at with no resolver configured', async () => {
    await model.removeWhere([{ label: 'x' }]);

    const sql = db.calls[0]!;
    expect(sql).toContain('deactivated_at = NOW()');
    expect(sql).toContain('updated_at = NOW()');
    // No actor resolved, so the column it names is left alone.
    expect(sql).not.toContain('updated_by');
  });

  it('restoreWhere advances updated_at with no resolver configured', async () => {
    await model.restoreWhere([{ label: 'x' }]);

    const sql = db.calls[0]!;
    expect(sql).toContain('deactivated_at = NULL');
    expect(sql).toContain('updated_at = NOW()');
    expect(sql).not.toContain('updated_by');
  });

  it('update() does not overwrite updated_by with null', async () => {
    // Assigning the unresolved actor put updated_by in the SET list, wiping the
    // last known actor on every subsequent update.
    await model.update(ID, { label: 'changed' } as never);

    const sql = db.calls[0]!;
    expect(sql).toContain('"label"');
    expect(sql).toContain('"updated_at"=CURRENT_TIMESTAMP');
    expect(sql).not.toContain('updated_by');
  });

  it('touch() still advances updated_at with no resolver', async () => {
    // touch() sent {} to update(), which rejected it as an empty DTO — the one
    // call whose whole purpose is bumping the timestamp.
    await expect(model.touch(ID)).resolves.toBeDefined();

    const sql = db.calls[0]!;
    expect(sql).toContain('"updated_at"=CURRENT_TIMESTAMP');
  });
});

describe('audit timestamps with an actor resolver', () => {
  let db: ReturnType<typeof makeCapturingDb>;
  let model: TableModel;

  beforeEach(() => {
    columnSetCache.clear();
    setAuditActorResolver(() => 'actor-1');
    db = makeCapturingDb();
    model = new TableModel(db, pgp, auditedSoftDelete);
  });

  it('removeWhere sets both columns', async () => {
    await model.removeWhere([{ label: 'x' }]);

    const sql = db.calls[0]!;
    expect(sql).toContain('updated_at = NOW()');
    expect(sql).toContain('updated_by = $');
  });

  it('restoreWhere sets both columns', async () => {
    await model.restoreWhere([{ label: 'x' }]);

    const sql = db.calls[0]!;
    expect(sql).toContain('updated_at = NOW()');
    expect(sql).toContain('updated_by = $');
  });

  it('update() fills updated_by from the resolver', async () => {
    await model.update(ID, { label: 'changed' } as never);

    const sql = db.calls[0]!;
    expect(sql).toContain(`"updated_by"='actor-1'`);
  });

  it('update() honors an explicit updated_by over the resolver', async () => {
    await model.update(ID, {
      label: 'changed',
      updated_by: 'explicit',
    } as never);

    const sql = db.calls[0]!;
    expect(sql).toContain(`"updated_by"='explicit'`);
    expect(sql).not.toContain('actor-1');
  });

  it('touch() prefers its explicit argument', async () => {
    await model.touch(ID, 'toucher');

    const sql = db.calls[0]!;
    expect(sql).toContain(`"updated_by"='toucher'`);
  });
});

describe('empty-DTO handling', () => {
  beforeEach(() => {
    clearAuditActorResolver();
    columnSetCache.clear();
  });

  it('update() rejects an empty DTO when audit fields are disabled', async () => {
    // Nothing to write: no caller columns and no library-owned ones.
    const model = new TableModel(makeCapturingDb(), pgp, unaudited);
    await expect(model.update(ID, {} as never)).rejects.toThrow(
      'DTO must be a non-empty object'
    );
  });

  it('update() still rejects a non-object DTO', async () => {
    const model = new TableModel(makeCapturingDb(), pgp, auditedSoftDelete);
    await expect(model.update(ID, null as never)).rejects.toThrow(
      'DTO must be a non-empty object'
    );
    await expect(model.update(ID, [] as never)).rejects.toThrow(
      'DTO must be a non-empty object'
    );
  });

  it('touch() rejects when audit fields are disabled', async () => {
    // Previously this produced the opaque "DTO must be a non-empty object" from
    // two frames down, naming neither touch() nor the actual requirement.
    const model = new TableModel(makeCapturingDb(), pgp, unaudited);
    await expect(model.touch(ID)).rejects.toThrow(SchemaDefinitionError);
    await expect(model.touch(ID)).rejects.toThrow(/audit fields/);
  });
});
