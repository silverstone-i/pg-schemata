/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// The migration tutorial in Examples/ is documentation that has to run. Nothing
// executed it, so it drifted: the runner destructured a { applied, files } shape
// applyAll() has never returned, migration 0001 called bootstrap() without the
// migration's own transaction, migration 0002 re-added columns the committed
// ordersSchema already declares (so a fresh run failed on "column already
// exists"), and every foreign key used a `dbSchema` key that ForeignKeyReference
// does not have — silently ignored, and only correct because the fallback
// resolved to the same schema.
//
// This exercises the tutorial's own schema objects and its migration sequence
// against a throwaway schema. It imports the schemas directly rather than the
// model classes, because those import 'pg-schemata' by package name, which does
// not resolve from inside the repo.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import crypto from 'crypto';
import DB from '../../src/DB.js';
import TableModel from '../../src/TableModel.js';
import { createTableSQL } from '../../src/utils/schemaBuilder.js';
import type { ExtendedDb } from '../../src/DB.js';
import type { DbConnection, TableSchema } from '../../src/schemaTypes.js';
import type { IMain } from 'pg-promise';

// @ts-expect-error -- plain JS fixtures shipped as tutorial source
import { customersSchema } from '../../Examples/migration-tutorial/src/schemas/customersSchema.js';
// @ts-expect-error -- plain JS fixtures shipped as tutorial source
import { ordersSchema } from '../../Examples/migration-tutorial/src/schemas/ordersSchema.js';
// @ts-expect-error -- plain JS fixtures shipped as tutorial source
import { orderItemsSchema } from '../../Examples/migration-tutorial/src/schemas/orderItemsSchema.js';

const dbSchema = `tutorial_${crypto.randomUUID().replace(/-/g, '')}`;

function scoped(schema: TableSchema): TableSchema {
  return { ...schema, dbSchema };
}

describe('migration tutorial example (integration)', () => {
  let db: ExtendedDb;
  let pgp: IMain;
  let orders: TableModel;

  let models: TableModel[];

  beforeAll(async () => {
    class Customers extends TableModel {
      constructor(d: DbConnection, p: IMain) {
        super(d, p, scoped(customersSchema as TableSchema));
      }
    }
    class Orders extends TableModel {
      constructor(d: DbConnection, p: IMain) {
        super(d, p, scoped(ordersSchema as TableSchema));
      }
    }
    class OrderItems extends TableModel {
      constructor(d: DbConnection, p: IMain) {
        super(d, p, scoped(orderItemsSchema as TableSchema));
      }
    }

    ({ db, pgp } = DB.init(process.env.DATABASE_URL!, {
      customers: Customers,
      orders: Orders,
      orderItems: OrderItems,
    }));
    const attached = db as any;
    orders = attached.orders as TableModel;
    // Parent-first: order_items references orders, which references customers.
    models = [attached.customers, attached.orders, attached.orderItems];

    await db.none(
      `DROP SCHEMA IF EXISTS "${dbSchema}" CASCADE; CREATE SCHEMA "${dbSchema}"`
    );
  });

  afterAll(async () => {
    await db.none(`DROP SCHEMA IF EXISTS "${dbSchema}" CASCADE`);
    // Per-instance shutdown; pgp.end() would close unrelated pools too.
    await DB.close();
  });

  it('creates all three tables parent-first, as migration 0001 does', async () => {
    // The tutorial's 0001 runs bootstrap({ models, schema, db }), which sorts
    // models by foreign key before emitting DDL. DDL comes off each model's
    // normalized schema — the raw fixture has no audit or soft-delete columns
    // yet, and customers' partial index filters on deactivated_at.
    await db.tx(async t => {
      for (const model of models) {
        await t.none(createTableSQL(model.schema));
      }
    });

    const tables = await db.any<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 ORDER BY table_name`,
      [dbSchema]
    );
    expect(tables.map(t => t.table_name)).toEqual([
      'customers',
      'order_items',
      'orders',
    ]);
  });

  it('resolves the foreign keys to the intended schema', async () => {
    // The `references.schema` key, not `dbSchema`. With the wrong key the
    // constraint still built — it fell back to the table's own schema — so the
    // typo was invisible until a reference pointed somewhere else.
    const fks = await db.any<{ table_name: string; foreign_table: string }>(
      `SELECT tc.table_name, ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
        ORDER BY tc.table_name`,
      [dbSchema]
    );

    expect(fks).toEqual([
      { table_name: 'order_items', foreign_table: 'orders' },
      { table_name: 'orders', foreign_table: 'customers' },
    ]);
  });

  it('applies migration 0002 on top of a fresh bootstrap', async () => {
    // The committed ordersSchema already declares status and shipped_at, so
    // bootstrap created them above. Without IF NOT EXISTS this throws 42701
    // and the tutorial cannot be run end to end as written.
    await expect(
      db.none(
        `ALTER TABLE "${dbSchema}"."orders"
           ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'pending',
           ADD COLUMN IF NOT EXISTS shipped_at timestamptz`
      )
    ).resolves.toBeDefined();

    const cols = await db.any<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'orders'`,
      [dbSchema]
    );
    const names = cols.map(c => c.column_name);
    expect(names).toContain('status');
    expect(names).toContain('shipped_at');
  });

  it('inserts an order without supplying id, as the README example does', async () => {
    // id carries a gen_random_uuid() default plus colProps.cnd, so it is absent
    // from the insert column list and the database supplies it.
    const customer = await db.one<{ id: string }>(
      `INSERT INTO "${dbSchema}"."customers" (email, full_name)
       VALUES ('a@example.com', 'Alice') RETURNING id`
    );

    const order = await orders.insert({
      customer_id: customer.id,
      order_number: 'ORD-0001',
      order_total: '25.00',
    } as never);

    expect(order.id).toBeTruthy();
    expect(order.status).toBe('pending');
  });
});
