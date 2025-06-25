'use strict';

import { has } from 'lodash';
/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

// schema-utils.test.js
import {
  createTableSQL,
  addAuditFields,
  createIndexesSQL,
  normalizeSQL,
  createColumnSet,
  columnSetCache,
} from '../../src/utils/schemaBuilder';
import { LRUCache } from 'lru-cache';

// Mock pg-promise and its helpers
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockExtend = vi.fn(columns => ({ extendedWith: columns }));

const mockColumnSet = vi.fn((columns, options) => ({
  columns,
  options,
  extend: mockExtend,
}));

const mockPgp = {
  helpers: {
    ColumnSet: mockColumnSet,
  },
};

describe('Schema Utilities', () => {
  describe('createTableSQL', () => {
    it('should generate correct CREATE TABLE SQL with columns and constraints', () => {
      const schema = {
        schemaName: 'public',
        table: 'users',
        columns: [
          { name: 'id', type: 'serial', notNull: true },
          { name: 'name', type: 'varchar(255)', notNull: true },
        ],
        constraints: {
          primaryKey: ['id'],
          unique: [['name']],
        },
      };

      const sql = createTableSQL(schema);

      expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS "public"');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."users"');
      expect(sql).toContain('"id" serial NOT NULL');
      expect(sql).toContain('"name" varchar(255) NOT NULL');
      expect(sql).toContain('PRIMARY KEY ("id")');
      expect(sql).toMatch(
        /CONSTRAINT "uidx_users_name_[a-z0-9]{6}" UNIQUE \("name"\)/
      );
    });

    it('should generate correct CREATE TABLE SQL with foreign keys', () => {
      const schema = {
        schemaName: 'public',
        table: 'posts',
        columns: [
          { name: 'id', type: 'serial', notNull: true },
          { name: 'user_id', type: 'int', notNull: true },
          { name: 'tenant_id', type: 'uuid', notNull: true },
        ],
        constraints: {
          primaryKey: ['id'],
          foreignKeys: [
            {
              columns: ['user_id', 'tenant_id'],
              references: {
                dbSchema: 'public',
                table: 'users',
                columns: ['id', 'tenant_id'], // <-- Added this
              },
            },
          ],
        },
      };

      const sql = createTableSQL(schema);

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."posts"');
      expect(sql).toContain('"id" serial NOT NULL');
      expect(sql).toContain('"user_id" int NOT NULL');
      expect(sql).toContain('PRIMARY KEY ("id")');
      expect(normalizeSQL(sql)).toMatch(
        /CONSTRAINT "fk_posts_[a-z0-9]{6}" FOREIGN KEY \("user_id", "tenant_id"\) REFERENCES "public"\."users" \("id", "tenant_id"\)/
      );
    });

    it('should throw an error for invalid foreign key reference', () => {
      const schema = {
        schemaName: 'public',
        table: 'posts',
        columns: [{ name: 'id', type: 'serial' }],
        constraints: {
          foreignKeys: [
            { columns: ['user_id'], references: 'invalid' }, // should be object
          ],
        },
      };

      expect(() => createTableSQL(schema)).toThrow(
        'Invalid foreign key reference for table posts: expected object, got string'
      );
    });

    it('should generate correct CREATE TABLE SQL with checks', () => {
      const schema = {
        schemaName: 'public',
        table: 'products',
        columns: [
          { name: 'id', type: 'serial', notNull: true },
          { name: 'price', type: 'decimal', notNull: true },
        ],
        constraints: {
          checks: [{ expression: 'price > 0' }],
        },
      };

      const sql = createTableSQL(schema);

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."products"');
      expect(sql).toContain('"id" serial NOT NULL');
      expect(sql).toContain('"price" decimal NOT NULL');
      expect(sql).toContain('CHECK (price > 0)');
    });

    it('should handle NOT NULL and DEFAULT in createTableSQL', () => {
      const schema = {
        schemaName: 'public',
        table: 'products',
        columns: [
          {
            name: 'id',
            type: 'serial',
            notNull: true,
            default: "nextval('products_id_seq')",
          },
        ],
        constraints: {},
      };

      const sql = createTableSQL(schema);

      expect(sql).toContain(
        '"id" serial NOT NULL DEFAULT nextval(\'products_id_seq\')'
      );
    });

    it('should handle schema with no constraints', () => {
      const schema = {
        schemaName: 'public',
        table: 'simple_table',
        columns: [{ name: 'id', type: 'serial' }],
        // ❌ No constraints field at all
      };

      const sql = createTableSQL(schema);

      expect(sql).toContain('"id" serial'); // Basic check
    });

    it('should generate FOREIGN KEY with ON DELETE and ON UPDATE actions', () => {
      const schema = {
        schemaName: 'public',
        table: 'orders',
        columns: [
          { name: 'id', type: 'serial' },
          { name: 'user_id', type: 'integer' },
        ],
        constraints: {
          foreignKeys: [
            {
              columns: ['user_id'],
              references: {
                dbSchema: 'public',
                table: 'users',
                columns: ['id'],
              },
              onDelete: 'CASCADE',
              onUpdate: 'SET NULL',
            },
          ],
        },
      };

      const sql = createTableSQL(schema);

      expect(sql).toContain('ON DELETE CASCADE');
      expect(sql).toContain('ON UPDATE SET NULL');
    });
  });

  describe('addAuditFields', () => {
    it('should add audit fields to the schema columns', () => {
      const schema = { hasAuditFields: true, columns: [] };
      const updatedSchema = addAuditFields(schema);
      console.log('Updated Schema:', updatedSchema);
      

      expect(updatedSchema.columns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'created_at' }),
          expect.objectContaining({ name: 'created_by' }),
          expect.objectContaining({ name: 'updated_at' }),
          expect.objectContaining({ name: 'updated_by' }),
        ])
      );
    });
  });

  describe('createIndexesSQL', () => {
    it('should generate correct CREATE INDEX SQL', () => {
      const schema = {
        schemaName: 'public',
        table: 'users',
        constraints: {
          indexes: [{ columns: ['email'] }, { columns: ['username'] }],
        },
      };

      const sql = createIndexesSQL(schema);

      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_users_email"');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_users_username"');
    });

    it('should handle schema without indexes gracefully', () => {
      const schema = {
        schemaName: 'public',
        table: 'users',
        constraints: {
          // ❌ no indexes field
        },
      };

      expect(() => createIndexesSQL(schema)).toThrow();
      // or handle it gracefully if you want (up to you!)
    });

    it('should generate correct unique CREATE INDEX SQL', () => {
      const schema = {
        schemaName: 'public',
        table: 'users',
        constraints: {
          indexes: [{ columns: ['email'] }, { columns: ['username'] }],
        },
      };

      const sql = createIndexesSQL(schema, true);

      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "uidx_users_email"');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "uidx_users_username"');
    });

    it('should handle schema without primary key in createColumnSet', () => {
      const schema = {
        dbSchema: 'public',
        table: 'products',
        columns: [
          {
            name: 'name',
            type: 'varchar(255)',
            nullable: true,
            colProps: { skip: c => !c.exists },
          },
          { name: 'price', type: 'numeric' },
        ],
        // ❌ No constraints.primaryKey
        constraints: {}, // <- empty constraints
      };

      const columnSet = createColumnSet(schema, mockPgp);

      const columnNames = columnSet.products.columns.map(col => col.name);

      expect(columnNames).toContain('name');
      expect(columnNames).toContain('price');

      // Make sure 'skip' was added (non-primary key columns have skip)
      const nameCol = columnSet.products.columns.find(
        col => col.name === 'name'
      );
      expect(typeof nameCol.skip).toBe('function');
    });
  });

  describe('normalizeSQL', () => {
    it('should normalize SQL by collapsing spaces and removing semicolons', () => {
      const rawSQL = `
        CREATE TABLE test (
          id SERIAL PRIMARY KEY
        );
      `;

      const normalized = normalizeSQL(rawSQL);

      expect(normalized).toBe('CREATE TABLE test ( id SERIAL PRIMARY KEY );');
    });
  });

  describe('createColumnSet', () => {
    beforeEach(() => {
      mockColumnSet.mockClear();
      mockExtend.mockClear();
      columnSetCache.clear(); // Clear the cache before each test
    });

    it('should create ColumnSet with insert and update extensions', () => {
      const schema = {
        dbSchema: 'public',
        table: 'users',
        hasAuditFields: true,
        columns: [
          { name: 'id', type: 'serial' },
          { name: 'name', type: 'varchar(255)' },
        ],
        constraints: {
          primaryKey: ['id'],
        },
      };

      const auditSchema = addAuditFields(schema);
      const columnSet = createColumnSet(auditSchema, mockPgp);

      expect(mockColumnSet).toHaveBeenCalledTimes(1);
      expect(columnSet).toHaveProperty('users');
      expect(columnSet).toHaveProperty('insert');
      expect(columnSet).toHaveProperty('update');
      expect(mockExtend).toHaveBeenCalledTimes(2);
      expect(columnSet.insert.extendedWith).toContain('created_by');
      expect(columnSet.update.extendedWith).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'updated_at',
            mod: '^',
            def: 'CURRENT_TIMESTAMP',
          }),
          'updated_by',
        ])
      );
    });

    it('should not extend insert and update if audit fields are missing', () => {
      const schema = {
        dbSchema: 'public',
        table: 'products',
        columns: [
          { name: 'id', type: 'serial' },
          { name: 'description', type: 'text' },
        ],
        constraints: {
          primaryKey: ['id'],
        },
      };

      const columnSet = createColumnSet(schema, mockPgp);

      expect(columnSet.insert).toBe(columnSet.products);
      expect(columnSet.update).toBe(columnSet.products);
      expect(mockExtend).not.toHaveBeenCalled();
    });

    it('should handle columns with default values correctly', () => {
      const schema = {
        dbSchema: 'public',
        table: 'orders',
        columns: [
          { name: 'id', type: 'serial' },
          { name: 'status', type: 'varchar(50)', default: 'pending' },
        ],
        constraints: {
          primaryKey: ['id'],
        },
      };

      const columnSet = createColumnSet(schema, mockPgp);

      expect(columnSet.orders.columns).toContainEqual(
        expect.objectContaining({ def: 'pending' })
      );
    });

    it('should skip missing columns correctly', () => {
      const schema = {
        dbSchema: 'public',
        table: 'orders',
        columns: [
          { name: 'id', type: 'serial' },
          {
            name: 'status',
            type: 'varchar(50)',
            default: 'pending',
            nullable: true,
            colProps: { skip: c => !c.exists },
          },
        ],
        constraints: {
          primaryKey: ['id'],
        },
      };

      const columnSet = createColumnSet(schema, mockPgp);
      const statusCol = columnSet.orders.columns.find(
        col => col.name === 'status'
      );

      expect(statusCol.skip({ exists: false })).toBe(true);
      expect(statusCol.skip({ exists: true })).toBe(false);
    });

    it('should recognize primary key columns that are not serial or uuid with default', () => {
      const schema = {
        dbSchema: 'public',
        table: 'orders',
        columns: [
          { name: 'id', type: 'int', colProps: { cnd: true } },
          { name: 'status', type: 'varchar(50)' },
        ],
        constraints: {
          primaryKey: ['id'],
        },
      };

      const columnSet = createColumnSet(schema, mockPgp);
      const idCol = columnSet.orders.columns.find(col => col.name === 'id');

      expect(idCol.cnd).toBe(true);
    });

    it('should skip columns with type uuid and is a primary key and has a default value in createColumnSet', () => {
      const schema = {
        dbSchema: 'public',
        table: 'test_table',
        columns: [
          { name: 'id', type: 'uuid', default: 'uuid_generate_v4()' }, // Should be skipped
          { name: 'email', type: 'varchar(255)' }, // Should stay
        ],
        constraints: {
          primaryKey: ['id'],
        },
      };

      const columnSet = createColumnSet(schema, mockPgp);
      const columnNames = columnSet.test_table.columns.map(col => col.name);
      expect(columnNames).not.toContain('id'); // 'id' should NOT be there
      expect(columnNames).toContain('email'); // 'email' should be there
    });

    it('should apply colProps for pg-promise column configuration', () => {
      const schema = {
        dbSchema: 'public',
        table: 'users',
        columns: [
          {
            name: 'address',
            type: 'jsonb',
            colProps: { mod: ':json', skip: c => !c.exists },
          },
          { name: 'email', type: 'varchar(255)' },
        ],
        constraints: {
          primaryKey: ['email'],
        },
      };

      const columnSet = createColumnSet(schema, mockPgp);
      const addressCol = columnSet.users.columns.find(
        col => col.name === 'address'
      );

      expect(addressCol.mod).toBe(':json');
      expect(typeof addressCol.skip).toBe('function');
      expect(addressCol.skip({ exists: false })).toBe(true);
    });
  });
  // LRU Cache tests for columnSetCache
  describe('columnSetCache (LRU)', () => {
    beforeEach(() => {
      columnSetCache.clear();
    });

    it('should store and retrieve a cached value', () => {
      const key = 'test-key';
      const value = { dummy: true };
      columnSetCache.set(key, value);
      expect(columnSetCache.get(key)).toEqual(value);
    });

    it('should evict the oldest entry when max size is exceeded', () => {
      const maxEntries = 20000;
      // Add max + 1 entries
      for (let i = 0; i <= maxEntries; i++) {
        columnSetCache.set(`key-${i}`, { value: i });
      }
      expect(columnSetCache.get('key-0')).toBeUndefined(); // key-0 should be evicted
    });

    // Use a dedicated LRUCache instance with a short TTL for this test

    it('should expire items after TTL', done => {
      const testCache = new LRUCache({ max: 10, ttl: 100 }); // 100ms TTL
      const key = 'ttl-key';
      const value = { dummy: 'expired' };
      testCache.set(key, value);

      setTimeout(() => {
        expect(testCache.get(key)).toBeUndefined();
        done();
      }, 200); // Wait longer than TTL
    });
  });
});
