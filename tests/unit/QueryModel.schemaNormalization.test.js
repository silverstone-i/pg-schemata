import { describe, it, expect, beforeEach } from 'vitest';

// No vi.mock here on purpose: these tests exercise the real schemaBuilder
// normalization path in the QueryModel constructor. The mocked suites stub
// addAuditFields as a pass-through, which is exactly how issue N1 (soft
// delete skipped when hasAuditFields is false) went undetected.
import pgPromise from 'pg-promise';
import QueryModel from '../../src/QueryModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';

const pgp = pgPromise({});
const stubDb = { one: async () => ({}), any: async () => [], oneOrNone: async () => null };

const AUDIT_COLUMNS = ['created_at', 'created_by', 'updated_at', 'updated_by'];

function makeSchema({ hasAuditFields, softDelete }, table) {
  return {
    dbSchema: 'public',
    table,
    hasAuditFields,
    softDelete,
    columns: [
      { name: 'id', type: 'uuid', default: 'gen_random_uuid()', notNull: true },
      { name: 'message', type: 'text', notNull: true },
    ],
    constraints: { primaryKey: ['id'] },
  };
}

describe('QueryModel constructor schema normalization (real schemaBuilder)', () => {
  beforeEach(() => {
    columnSetCache.clear();
  });

  it('adds only deactivated_at when softDelete is on and audit fields are off (N1)', () => {
    const model = new QueryModel(stubDb, pgp, makeSchema({ hasAuditFields: false, softDelete: true }, 'norm_sd_only'));
    const names = model.schema.columns.map(c => c.name);
    expect(names).toEqual(['id', 'message', 'deactivated_at']);
  });

  it('adds only audit fields when audit is on and softDelete is off', () => {
    const model = new QueryModel(stubDb, pgp, makeSchema({ hasAuditFields: true, softDelete: false }, 'norm_audit_only'));
    const names = model.schema.columns.map(c => c.name);
    expect(names).toEqual(['id', 'message', ...AUDIT_COLUMNS]);
  });

  it('adds both when both flags are on', () => {
    const model = new QueryModel(stubDb, pgp, makeSchema({ hasAuditFields: true, softDelete: true }, 'norm_both'));
    const names = model.schema.columns.map(c => c.name);
    expect(names).toEqual(['id', 'message', ...AUDIT_COLUMNS, 'deactivated_at']);
  });

  it('adds nothing when both flags are off', () => {
    const model = new QueryModel(stubDb, pgp, makeSchema({ hasAuditFields: false, softDelete: false }, 'norm_neither'));
    const names = model.schema.columns.map(c => c.name);
    expect(names).toEqual(['id', 'message']);
  });

  it('never mutates the schema object passed by the caller', () => {
    const schema = makeSchema({ hasAuditFields: true, softDelete: true }, 'norm_no_mutate');
    const before = JSON.stringify(schema);
    new QueryModel(stubDb, pgp, schema);
    expect(JSON.stringify(schema)).toBe(before);
  });
});

describe('column defaults through the real ColumnSet (N3)', () => {
  beforeEach(() => {
    columnSetCache.clear();
  });

  const schema = {
    dbSchema: 'public',
    table: 'n3_defaults',
    hasAuditFields: false,
    softDelete: false,
    columns: [
      { name: 'name', type: 'text', notNull: true },
      { name: 'status', type: 'varchar(20)', default: "'live'", notNull: true },
    ],
    constraints: { primaryKey: ['name'] },
  };

  it('emits the DEFAULT keyword when a defaulted column is omitted from the DTO', () => {
    const model = new QueryModel(stubDb, pgp, schema);
    const sql = pgp.helpers.insert({ name: 'x' }, model.cs[schema.table]);
    expect(sql).toBe('insert into "public"."n3_defaults"("name","status") values(\'x\',DEFAULT)');
  });

  it('formats a supplied value normally, including escaping', () => {
    const model = new QueryModel(stubDb, pgp, schema);
    const sql = pgp.helpers.insert({ name: 'x', status: "o'k" }, model.cs[schema.table]);
    expect(sql).toBe('insert into "public"."n3_defaults"("name","status") values(\'x\',\'o\'\'k\')');
  });
});

describe('buildValuesClause (issue 13)', () => {
  beforeEach(() => {
    columnSetCache.clear();
  });

  it('produces a VALUES clause from the table ColumnSet', () => {
    const model = new QueryModel(stubDb, pgp, {
      dbSchema: 'public',
      table: 'bvc_rows',
      hasAuditFields: false,
      softDelete: false,
      columns: [
        { name: 'name', type: 'text', notNull: true },
        { name: 'note', type: 'text' },
      ],
      constraints: { primaryKey: ['name'] },
    });

    expect(model.buildValuesClause([{ name: 'a', note: "o'k" }, { name: 'b', note: null }]))
      .toBe("('a','o''k'),('b',null)");
    expect(model.buildValuesClause([])).toBe('');
  });
});
