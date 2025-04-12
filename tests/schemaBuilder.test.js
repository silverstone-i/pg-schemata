'use strict';

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
} from '../src/utils/schemaBuilder';

// Mock pg-promise and its helpers
const mockExtend = jest.fn(columns => ({ extendedWith: columns }));

const mockColumnSet = jest.fn((columns, options) => ({
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

      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public"."users"');
      expect(sql).toContain('"id" serial NOT NULL');
      expect(sql).toContain('"name" varchar(255) NOT NULL');
      expect(sql).toContain('PRIMARY KEY ("id")');
      expect(sql).toMatch(
        /CONSTRAINT "uidx_users_name_[a-z0-9]{6}" UNIQUE \("name"\)/
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
  });

  describe('addAuditFields', () => {
    it('should add audit fields to the schema columns', () => {
      const schema = { columns: [] };
      const updatedSchema = addAuditFields(schema);

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
    });

    it('should create ColumnSet with insert and update extensions', () => {
      const schema = {
        schema: 'public',
        table: 'users',
        columns: [
          { name: 'id', type: 'serial' },
          { name: 'name', type: 'varchar(255)' },
        ],
        constraints: {
          primaryKey: ['id'],
        },
      };

      const auditSchema = addAuditFields(schema);
      console.log('auditSchema', JSON.stringify(auditSchema));

      const columnSet = createColumnSet(auditSchema, mockPgp);
      console.log('columnSet', JSON.stringify(columnSet));

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
        schema: 'public',
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
  });
});

