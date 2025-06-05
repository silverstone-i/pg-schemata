import { describe, it, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/utils/schemaBuilder', () => ({
  addAuditFields: vi.fn(schema => schema),
  createColumnSet: vi.fn(() => ({
    insert: vi.fn(),
    update: {},
  })),
}));

import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import QueryModel from '../../src/QueryModel.js';

const mockDb = {
  one: vi.fn(),
  any: vi.fn(),
  oneOrNone: vi.fn(),
};

const mockPgp = {
  as: {
    name: vi.fn(name => `"${name}"`),
    format: vi.fn((query, values) => query.replace('$1', values[0])),
  },
};

const mockSchema = {
  dbSchema: 'public',
  table: 'users',
  columns: [{ name: 'id' }, { name: 'email' }, { name: 'password' }],
  constraints: { primaryKey: ['id'] },
};

describe('QueryModel', () => {
  let model;

  beforeEach(() => {
    vi.clearAllMocks();
    model = new QueryModel(mockDb, mockPgp, mockSchema);
    model.logQuery = vi.fn();
  });

  describe('Constructor Validation', () => {
    test('should throw if schema is not an object', () => {
      expect(() => new QueryModel(mockDb, mockPgp, 'invalid')).toThrow(
        'Schema must be an object'
      );
    });

    test('should throw if required parameters are missing', () => {
      expect(() => new QueryModel(mockDb, mockPgp, {})).toThrow(
        'Missing required parameters: db, pgp, schema, table, or primary key'
      );
    });
  });

  describe('Utility Methods', () => {
    test('escapeName should wrap name in quotes', () => {
      expect(model.escapeName('foo')).toBe('"foo"');
    });
  });

  describe('buildCondition', () => {
    test('should handle simple equality condition', () => {
      const values = [];
      const clause = model.buildCondition([{ id: 1 }], 'AND', values);
      expect(clause).toBe('"id" = $1');
      expect(values).toEqual([1]);
    });

    test('should handle multiple conditions joined with AND', () => {
      const values = [];
      const clause = model.buildCondition([{ id: 1 }, { email: 'test@example.com' }], 'AND', values);
      expect(clause).toBe('"id" = $1 AND "email" = $2');
      expect(values).toEqual([1, 'test@example.com']);
    });

    test('should handle $or condition block', () => {
      const values = [];
      const clause = model.buildCondition([{ $or: [{ id: 1 }, { id: 2 }] }], 'AND', values);
      expect(clause).toBe('("id" = $1 OR "id" = $2)');
      expect(values).toEqual([1, 2]);
    });

    test('should wrap $or block and allow top-level AND joiner', () => {
      const values = [];
      const clause = model.buildCondition(
        [{ $or: [{ id: 1 }, { id: 2 }] }, { email: 'a@x.com' }],
        'AND',
        values
      );
      expect(clause).toBe('("id" = $1 OR "id" = $2) AND "email" = $3');
      expect(values).toEqual([1, 2, 'a@x.com']);
    });

    test('should wrap $or block and allow top-level OR joiner', () => {
      const values = [];
      const clause = model.buildCondition(
        [{ $or: [{ id: 1 }, { id: 2 }] }, { email: 'a@x.com' }],
        'OR',
        values
      );
      expect(clause).toBe('("id" = $1 OR "id" = $2) OR "email" = $3');
      expect(values).toEqual([1, 2, 'a@x.com']);
    });

    test('should handle $ilike operator', () => {
      const values = [];
      const clause = model.buildCondition([{ email: { $ilike: '%@example.com' } }], 'AND', values);
      expect(clause).toBe('"email" ILIKE $1');
      expect(values).toEqual(['%@example.com']);
    });

    test('should handle range with $from and $to', () => {
      const values = [];
      const clause = model.buildCondition([{ created_at: { $from: '2024-01-01', $to: '2024-12-31' } }], 'AND', values);
      expect(clause).toBe('"created_at" >= $1 AND "created_at" <= $2');
      expect(values).toEqual(['2024-01-01', '2024-12-31']);
    });

    test('should throw on unsupported operator', () => {
      const values = [];
      const conditions = [{ email: { likee: 'invalid' } }];
      expect(() => model.buildCondition(conditions, 'AND', values)).toThrow('Unsupported operator: likee');
    });
  });

  describe('buildWhereClause', () => {
    test('should build clause from simple object', () => {
      const values = [];
      const { clause, values: resultValues } = model.buildWhereClause({ id: 1, email: 'a@x.com' }, true, values);
      expect(clause).toBe('"id" = $1 AND "email" = $2');
      expect(resultValues).toEqual([1, 'a@x.com']);
    });

    test('should build clause from array of condition objects', () => {
      const values = [];
      const { clause, values: resultValues } = model.buildWhereClause([{ id: 1 }, { email: 'a@x.com' }], true, values);
      expect(clause).toBe('"id" = $1 AND "email" = $2');
      expect(resultValues).toEqual([1, 'a@x.com']);
    });

    test('should build clause from $or condition array', () => {
      const values = [];
      const where = [{ $or: [{ id: 1 }, { id: 2 }] }, { email: { $ilike: '%@x.com' } }];
      const { clause, values: resultValues } = model.buildWhereClause(where, true, values);
      expect(clause).toBe('("id" = $1 OR "id" = $2) AND "email" ILIKE $3');
      expect(resultValues).toEqual([1, 2, '%@x.com']);
    });

    test('should build clause from nested $or and AND blocks', () => {
      const values = [];
      const where = [
        { $or: [{ id: 1 }, { id: 2 }] },
        { $or: [{ email: 'a@x.com' }, { email: 'b@x.com' }] },
        { password: 'secret' }
      ];
      const { clause, values: resultValues } = model.buildWhereClause(where, true, values);
      expect(clause).toBe('("id" = $1 OR "id" = $2) AND ("email" = $3 OR "email" = $4) AND "password" = $5');
      expect(resultValues).toEqual([1, 2, 'a@x.com', 'b@x.com', 'secret']);
    });

    test('should allow empty object if requireNonEmpty is false', () => {
      const values = [];
      const { clause, values: resultValues } = model.buildWhereClause({}, false, values);
      expect(clause).toBe('');
      expect(resultValues).toEqual([]);
    });

    test('should throw on empty object if requireNonEmpty is true', () => {
      expect(() => model.buildWhereClause({}, true)).toThrow('WHERE clause must be a non-empty object');
    });

    test('should throw on object with invalid condition structure', () => {
      // const values = [];
      // const invalidClause = [{ id: { not_supported: 123 } }];
      expect(() => model.buildWhereClause('invalidClause', true)).toThrow('WHERE clause must be an array or plain object');
    });
  });

  describe('Read Operations', () => {
    test('findAll should query with limit/offset', async () => {
      mockDb.any.mockResolvedValue([{ id: 1 }]);
      const result = await model.findAll({ limit: 5, offset: 0 });
      expect(result).toEqual([{ id: 1 }]);
    });

    test('findById should return record', async () => {
      mockDb.any.mockResolvedValue([{ id: 2 }]);
      const result = await model.findById(2);
      expect(result).toEqual({ id: 2 });
    });

    test('findOneBy should return first match', async () => {
      mockDb.any.mockResolvedValue([{ id: 3 }]);
      const result = await model.findOneBy([{ id: 3 }]);
      expect(result).toEqual({ id: 3 });
    });

    test('findOneBy should return null if none match', async () => {
      mockDb.any.mockResolvedValue([]);
      const result = await model.findOneBy([{ id: 999 }]);
      expect(result).toBeNull();
    });

    test('exists should return true/false', async () => {
      mockDb.one.mockResolvedValue({ exists: true });
      const result = await model.exists({ email: 'a@x.com' });
      expect(result).toBe(true);
    });

    test('count should return numeric count', async () => {
      mockDb.one.mockResolvedValue({ count: '42' });
      const result = await model.count({ email: 'a@x.com' });
      expect(result).toBe(42);
    });

    test('findWhere should include basic where clause', async () => {
      mockDb.any.mockResolvedValue([{ id: 1 }]);
      const result = await model.findWhere([{ id: 1 }]);
      expect(result).toEqual([{ id: 1 }]);
    });

    test('findWhere should return filtered results with simple object', async () => {
      mockDb.any.mockResolvedValue([{ id: 1 }]);
      const result = await model.findWhere([{ id: 1 }]);
      expect(result).toEqual([{ id: 1 }]);
    });

    test('findWhere should return filtered results from array of condition objects', async () => {
      mockDb.any.mockResolvedValue([{ id: 2 }]);
      const result = await model.findWhere([{ id: 2 }, { email: 'a@x.com' }]);
      expect(result).toEqual([{ id: 2 }]);
    });

    test('findWhere should return filtered results with $or block', async () => {
      mockDb.any.mockResolvedValue([{ id: 1 }]);
      const result = await model.findWhere([{ $or: [{ id: 1 }, { id: 2 }] }, { email: { $ilike: '%@x.com' } }]);
      expect(result).toEqual([{ id: 1 }]);
    });

    test('findWhere should return filtered results with nested $or and AND blocks', async () => {
      mockDb.any.mockResolvedValue([{ id: 3 }]);
      const result = await model.findWhere([
        { $or: [{ id: 1 }, { id: 2 }] },
        { $or: [{ email: 'a@x.com' }, { email: 'b@x.com' }] },
        { password: 'secret' }
      ]);
      expect(result).toEqual([{ id: 3 }]);
    });
  });

  describe('Error Handling', () => {
    test('findById should throw on invalid id', async () => {
      await expect(model.findById(null)).rejects.toThrow('Invalid ID format');
    });

    test('exists should throw if conditions is not an object', async () => {
      await expect(model.exists(null)).rejects.toThrow(
        'Conditions must be a non-empty object'
      );
    });

    test('exists should throw if conditions is empty', async () => {
      await expect(model.exists({})).rejects.toThrow(
        'Conditions must be a non-empty object'
      );
    });

    test('findWhere should return all when conditions array is empty', async () => {
      mockDb.any.mockResolvedValue([{ id: 3 }]);
      const result = await model.findWhere([]);
      expect(result).toEqual([{ id: 3 }]);
    });
  });
});