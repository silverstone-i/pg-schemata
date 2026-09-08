/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IMain } from 'pg-promise';
import TableModel from '../../src/TableModel.js';
import { MigrationManager } from '../../src/migrate/MigrationManager.js';
import { defineMigration } from '../../src/migrate/defineMigration.js';
import type { DbConnection } from '../../src/schemaTypes.js';
import { createTestContext } from '../helpers/integrationHarness.js';
import type { TestContext } from '../helpers/integrationHarness.js';

class PortalUsers extends TableModel {
  constructor(db: DbConnection, pgp: IMain) {
    super(db, pgp, {
      dbSchema: 'placeholder',
      table: 'portal_users',
      columns: [
        { name: 'id', type: 'serial' },
        { name: 'email', type: 'text', notNull: true },
        { name: 'deactivated_at', type: 'timestamptz' },
      ],
      constraints: {
        primaryKey: ['id'],
        indexes: [
          {
            name: 'portal_users_active_email',
            columns: [{ expression: 'lower(email)' }],
            unique: true,
            where: 'deactivated_at IS NULL',
          },
        ],
      },
    });
  }
}

describe('expression index migration (PostgreSQL)', () => {
  let context: TestContext;
  beforeAll(async () => {
    context = await createTestContext({
      dbSchema: 'expression_idx',
      table: 'harness_anchor',
      columns: [{ name: 'id', type: 'integer' }],
      constraints: { primaryKey: ['id'] },
    });
  });
  afterAll(async () => {
    await context?.teardown();
  });

  it('migrates a unique partial expression index and enforces active email uniqueness', async () => {
    const db = context.ctx.db;
    const schema = context.model.schema.dbSchema;
    const manager = new MigrationManager({
      schema,
      modules: [
        {
          name: 'portal',
          models: { users: PortalUsers },
          migrations: [
            defineMigration({
              id: '0001-portal-users',
              up: async ({ models }) => {
                await (models.users as PortalUsers).createTable();
              },
            }),
          ],
        },
      ],
    });
    expect((await manager.applyAll()).applied).toHaveLength(1);
    const index = await db.one<{ indexdef: string }>(
      'SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2',
      [schema, 'portal_users_active_email']
    );
    expect(index.indexdef).toContain('CREATE UNIQUE INDEX');
    expect(index.indexdef).toContain('lower(email)');
    expect(index.indexdef).toContain('WHERE (deactivated_at IS NULL)');

    const insert = (email: string, inactive = false) =>
      db.none(
        'INSERT INTO $1:name.portal_users (email, deactivated_at) VALUES ($2, $3)',
        [schema, email, inactive ? new Date() : null]
      );
    await insert('Alice@example.com');
    await expect(insert('ALICE@example.com')).rejects.toMatchObject({
      code: '23505',
      constraint: 'portal_users_active_email',
    });
    await insert('ALICE@example.com', true);
    await insert('alice@example.com', true);
    await insert('Bob@example.com');
    await db.none(
      'UPDATE $1:name.portal_users SET deactivated_at = now() WHERE deactivated_at IS NULL AND email = $2',
      [schema, 'Alice@example.com']
    );
    await insert('alice@example.com');
    await expect(
      db.none(
        'UPDATE $1:name.portal_users SET deactivated_at = NULL WHERE email = $2',
        [schema, 'Alice@example.com']
      )
    ).rejects.toMatchObject({ code: '23505' });
    expect((await manager.applyAll()).applied).toHaveLength(0);
  });
});
