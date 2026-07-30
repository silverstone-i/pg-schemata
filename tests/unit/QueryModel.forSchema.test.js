import { describe, it, expect, beforeEach } from 'vitest';

// Real pg-promise and real schemaBuilder: these tests assert the SQL that
// actually reaches the executor, including the schema baked into each
// clone's ColumnSet.
import pgPromise from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import { columnSetCache } from '../../src/utils/schemaBuilder.js';

const pgp = pgPromise({});

function makeStubDb(captured) {
  return {
    one: q => {
      captured.push(q);
      return Promise.resolve({ id: 1 });
    },
    any: q => {
      captured.push(q);
      return Promise.resolve([]);
    },
    none: q => {
      captured.push(q);
      return Promise.resolve(null);
    },
    result: q => {
      captured.push(q);
      return Promise.resolve({ rowCount: 0 });
    },
  };
}

const schema = {
  dbSchema: 'public',
  table: 'fs_tenants',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'id', type: 'uuid', default: 'gen_random_uuid()', notNull: true },
    { name: 'name', type: 'text', notNull: true },
  ],
  constraints: { primaryKey: ['id'] },
};

describe('forSchema', () => {
  let captured;
  let model;

  beforeEach(() => {
    columnSetCache.clear();
    captured = [];
    model = new TableModel(makeStubDb(captured), pgp, schema);
  });

  it('routes interleaved requests to their own schemas (issue 1)', async () => {
    const a = model.forSchema('tenant_a');
    const b = model.forSchema('tenant_b');

    // The setSchemaName failure mode: A resolves, B resolves, then A runs.
    await a.insert({ name: 'row-for-A' });
    await b.insert({ name: 'row-for-B' });
    await a.insert({ name: 'row-for-A-again' });

    expect(captured[0]).toContain('"tenant_a"."fs_tenants"');
    expect(captured[1]).toContain('"tenant_b"."fs_tenants"');
    expect(captured[2]).toContain('"tenant_a"."fs_tenants"');
  });

  it('bakes the schema into the clone ColumnSet (protects the issue-2 trap)', () => {
    const a = model.forSchema('tenant_a');
    expect(a.cs[schema.table].table.toString()).toBe('"tenant_a"."fs_tenants"');
    expect(model.cs[schema.table].table.toString()).toBe(
      '"public"."fs_tenants"'
    );
  });

  it('never mutates the base model', async () => {
    model.forSchema('tenant_a');
    expect(model.schema.dbSchema).toBe('public');
    await model.insert({ name: 'base-row' });
    expect(captured[0]).toContain('"public"."fs_tenants"');
  });

  it('returns this when already bound to the requested schema', () => {
    expect(model.forSchema('public')).toBe(model);
    const a = model.forSchema('tenant_a');
    expect(a.forSchema('tenant_a')).toBe(a);
  });

  it('returns the same cached clone on repeat calls', () => {
    expect(model.forSchema('tenant_a')).toBe(model.forSchema('tenant_a'));
    expect(model.forSchema('tenant_a')).not.toBe(model.forSchema('tenant_b'));
  });

  it('does not share clones across base instances with different executors', async () => {
    // pg-promise's `extend` rebuilds repositories per task/transaction with
    // a different db executor; a clone cached for the root instance must not
    // be handed to a transaction-context instance.
    const txCaptured = [];
    const txModel = new TableModel(makeStubDb(txCaptured), pgp, schema);

    const rootClone = model.forSchema('tenant_a');
    const txClone = txModel.forSchema('tenant_a');

    expect(txClone).not.toBe(rootClone);
    await txClone.insert({ name: 'tx-row' });
    expect(txCaptured).toHaveLength(1);
    expect(captured).toHaveLength(0);

    // The heavy object is still shared: both clones draw the same ColumnSet
    // from the schemaBuilder LRU cache.
    expect(txClone.cs).toBe(rootClone.cs);
  });

  it('rejects an invalid schema name', () => {
    expect(() => model.forSchema('')).toThrow(
      'Schema name must be a non-empty string'
    );
    expect(() => model.forSchema(null)).toThrow(
      'Schema name must be a non-empty string'
    );
  });
});
