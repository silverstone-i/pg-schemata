/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { describe, it, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/utils/schemaBuilder.js', () => ({
  addAuditFields: vi.fn(schema => schema),
  addSoftDeleteField: vi.fn(schema => schema),
  createColumnSet: vi.fn(() => ({
    insert: vi.fn(),
    update: {},
  })),
}));

import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';
import QueryModel from '../../src/QueryModel.js';
import type { IMain } from 'pg-promise';
import type {
  ColumnDefinition,
  DbConnection,
  TableSchema,
} from '../../src/schemaTypes.js';
import type { FiltersInput } from '../../src/queryTypes.js';

const mockDb = {
  one: vi.fn(),
  any: vi.fn(),
  oneOrNone: vi.fn(),
};

const mockPgp = {
  as: {
    name: vi.fn((name: string) => `"${name}"`),
    format: vi.fn((query: string, values: unknown[]) =>
      query.replace('$1', values[0] as string)
    ),
  },
};

// Columns deliberately omit `type`: the mocked schemaBuilder never reads it.
const mockSchema = {
  dbSchema: 'public',
  table: 'users',
  columns: [{ name: 'id' }, { name: 'email' }, { name: 'password' }],
  constraints: { primaryKey: ['id'] },
} as unknown as TableSchema;

describe('QueryModel', () => {
  let model: QueryModel & { logQuery?: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    model = new QueryModel(
      mockDb as unknown as DbConnection,
      mockPgp as unknown as IMain,
      mockSchema
    );
    model.logQuery = vi.fn();
  });

  describe('Constructor Validation', () => {
    test('should throw if schema is not an object', () => {
      expect(
        () =>
          new QueryModel(
            mockDb as unknown as DbConnection,
            mockPgp as unknown as IMain,
            // @ts-expect-error deliberately passes a string instead of a schema
            'invalid'
          )
      ).toThrow('Schema must be an object');
    });

    test('should throw if required parameters are missing', () => {
      expect(
        () =>
          new QueryModel(
            mockDb as unknown as DbConnection,
            mockPgp as unknown as IMain,
            // @ts-expect-error deliberately passes an empty schema object
            {}
          )
      ).toThrow(
        'Missing required parameters: db, pgp, schema.table, or schema.columns'
      );
    });
  });

  describe('Utility Methods', () => {
    test('escapeName should wrap name in quotes', () => {
      expect(model.escapeName('foo')).toBe('"foo"');
    });

    test('sanitizeDto should strip invalid fields', () => {
      const sanitized = model.sanitizeDto({
        id: 1,
        email: 'test@example.com',
        invalidField: 'bad',
      });
      expect(sanitized).toEqual({ id: 1, email: 'test@example.com' });
    });

    test('sanitizeDto should remove immutable fields when includeImmutable is false', () => {
      model._schema.columns.push({
        name: 'created_at',
        immutable: true,
      } as ColumnDefinition);
      const sanitized = model.sanitizeDto(
        { id: 1, email: 'test@example.com', created_at: '2024-01-01' },
        { includeImmutable: false }
      );
      expect(sanitized).toEqual({ id: 1, email: 'test@example.com' });
    });
  });

  describe('buildCondition', () => {
    test('should handle simple equality condition', () => {
      const values: unknown[] = [];
      const clause = model.buildCondition([{ id: 1 }], 'AND', values);
      expect(clause).toBe('"id" = $1');
      expect(values).toEqual([1]);
    });

    test('should handle multiple conditions joined with AND', () => {
      const values: unknown[] = [];
      const clause = model.buildCondition(
        [{ id: 1 }, { email: 'test@example.com' }],
        'AND',
        values
      );
      expect(clause).toBe('"id" = $1 AND "email" = $2');
      expect(values).toEqual([1, 'test@example.com']);
    });

    test('should handle $or condition block', () => {
      const values: unknown[] = [];
      const clause = model.buildCondition(
        [{ $or: [{ id: 1 }, { id: 2 }] }],
        'AND',
        values
      );
      expect(clause).toBe('("id" = $1 OR "id" = $2)');
      expect(values).toEqual([1, 2]);
    });

    test('should wrap $or block and allow top-level AND joiner', () => {
      const values: unknown[] = [];
      const clause = model.buildCondition(
        [{ $or: [{ id: 1 }, { id: 2 }] }, { email: 'a@x.com' }],
        'AND',
        values
      );
      expect(clause).toBe('("id" = $1 OR "id" = $2) AND "email" = $3');
      expect(values).toEqual([1, 2, 'a@x.com']);
    });

    test('should wrap $or block and allow top-level OR joiner', () => {
      const values: unknown[] = [];
      const clause = model.buildCondition(
        [{ $or: [{ id: 1 }, { id: 2 }] }, { email: 'a@x.com' }],
        'OR',
        values
      );
      expect(clause).toBe('("id" = $1 OR "id" = $2) OR "email" = $3');
      expect(values).toEqual([1, 2, 'a@x.com']);
    });

    test('should handle $ilike operator', () => {
      const values: unknown[] = [];
      const clause = model.buildCondition(
        [{ email: { $ilike: '%@example.com' } }],
        'AND',
        values
      );
      expect(clause).toBe('"email" ILIKE $1');
      expect(values).toEqual(['%@example.com']);
    });

    test('should handle range with $from and $to', () => {
      const values: unknown[] = [];
      const clause = model.buildCondition(
        [{ created_at: { $from: '2024-01-01', $to: '2024-12-31' } }],
        'AND',
        values
      );
      expect(clause).toBe('"created_at" >= $1 AND "created_at" <= $2');
      expect(values).toEqual(['2024-01-01', '2024-12-31']);
    });

    test('should throw on unsupported operator', () => {
      const values: unknown[] = [];
      const conditions = [{ email: { likee: 'invalid' } }];
      // @ts-expect-error deliberately uses an unsupported operator
      expect(() => model.buildCondition(conditions, 'AND', values)).toThrow(
        'Unsupported operator: likee'
      );
    });
  });

  describe('findAfterCursor', () => {
    test('should return paginated rows and nextCursor', async () => {
      mockDb.any.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await model.findAfterCursor({ id: 0 }, 2, ['id']);
      expect(result.rows.length).toBe(2);
      expect(result.nextCursor).toEqual({ id: 2 });
    });

    test('should return null nextCursor if no rows', async () => {
      mockDb.any.mockResolvedValue([]);
      const result = await model.findAfterCursor({ id: 100 }, 10, ['id']);
      expect(result.rows).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    test('should throw if cursor is missing required key', async () => {
      await expect(
        model.findAfterCursor({ other_id: 1 }, 10, ['id'])
      ).rejects.toThrow('Missing cursor for id');
    });

    test('should apply filters and ordering with direction and whitelist', async () => {
      mockDb.any.mockResolvedValue([{ id: 3 }]);
      const result = await model.findAfterCursor({ id: 2 }, 1, ['id'], {
        descending: true,
        columnWhitelist: ['id'],
        filters: {
          and: [{ email: { $like: '%example.com' } }],
        },
      });
      expect(result.rows).toEqual([{ id: 3 }]);
    });
  });

  describe('buildWhereClause', () => {
    test('should build clause from simple object', () => {
      const values: unknown[] = [];
      const { clause, values: resultValues } = model.buildWhereClause(
        { id: 1, email: 'a@x.com' },
        true,
        values
      );
      expect(clause).toBe('"id" = $1 AND "email" = $2');
      expect(resultValues).toEqual([1, 'a@x.com']);
    });

    test('should build clause from array of condition objects', () => {
      const values: unknown[] = [];
      const { clause, values: resultValues } = model.buildWhereClause(
        [{ id: 1 }, { email: 'a@x.com' }],
        true,
        values
      );
      expect(clause).toBe('"id" = $1 AND "email" = $2');
      expect(resultValues).toEqual([1, 'a@x.com']);
    });

    test('should build clause from $or condition array', () => {
      const values: unknown[] = [];
      const where = [
        { $or: [{ id: 1 }, { id: 2 }] },
        { email: { $ilike: '%@x.com' } },
      ];
      const { clause, values: resultValues } = model.buildWhereClause(
        where,
        true,
        values
      );
      expect(clause).toBe('("id" = $1 OR "id" = $2) AND "email" ILIKE $3');
      expect(resultValues).toEqual([1, 2, '%@x.com']);
    });

    test('should build clause from nested $or and AND blocks', () => {
      const values: unknown[] = [];
      const where = [
        { $or: [{ id: 1 }, { id: 2 }] },
        { $or: [{ email: 'a@x.com' }, { email: 'b@x.com' }] },
        { password: 'secret' },
      ];
      const { clause, values: resultValues } = model.buildWhereClause(
        where,
        true,
        values
      );
      expect(clause).toBe(
        '("id" = $1 OR "id" = $2) AND ("email" = $3 OR "email" = $4) AND "password" = $5'
      );
      expect(resultValues).toEqual([1, 2, 'a@x.com', 'b@x.com', 'secret']);
    });

    test('should allow empty object if requireNonEmpty is false', () => {
      const values: unknown[] = [];
      const { clause, values: resultValues } = model.buildWhereClause(
        {},
        false,
        values
      );
      expect(clause).toBe('');
      expect(resultValues).toEqual([]);
    });

    test('should throw on empty object if requireNonEmpty is true', () => {
      expect(() => model.buildWhereClause({}, true)).toThrow(
        'WHERE clause must be a non-empty object'
      );
    });

    test('should throw on object with invalid condition structure', () => {
      // const values = [];
      // const invalidClause = [{ id: { not_supported: 123 } }];
      // @ts-expect-error deliberately passes a string instead of conditions
      expect(() => model.buildWhereClause('invalidClause', true)).toThrow(
        'WHERE clause must be an array or plain object'
      );
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

    test('count should return numeric count of all records where email is a@x.com', async () => {
      mockDb.one.mockResolvedValue({ count: '42' });
      const result = await model.countWhere({ email: 'a@x.com' });
      expect(result).toBe(42);
    });

    test('countWhere applies the WHERE clause when given a plain object (issue 9)', async () => {
      mockDb.one.mockResolvedValue({ count: '1' });
      await model.countWhere({ email: 'a@x.com' });
      const [query, values] = mockDb.one.mock.calls.at(-1)!;
      expect(query).toContain('WHERE');
      expect(query).toContain('"email" = $1');
      expect(values).toEqual(['a@x.com']);
    });

    test('findWhere accepts a plain object as conditions (issue 9)', async () => {
      mockDb.any.mockResolvedValue([]);
      await model.findWhere({ email: 'a@x.com' });
      const [query, values] = mockDb.any.mock.calls.at(-1)!;
      expect(query).toContain('"email" = $1');
      expect(values).toEqual(['a@x.com']);
    });

    test('findWhere and countWhere reject conditions that are neither array nor object (issue 9)', async () => {
      // @ts-expect-error deliberately passes a raw SQL string as conditions
      await expect(model.findWhere('email = 1')).rejects.toThrow(
        'Conditions must be an array or a plain object'
      );
      // @ts-expect-error deliberately passes a number as conditions
      await expect(model.countWhere(42)).rejects.toThrow(
        'Conditions must be an array or a plain object'
      );
    });

    test('findWhere rejects non-numeric limit and offset instead of emitting NaN (suggestion 5)', async () => {
      await expect(
        model.findWhere([{ id: 1 }], 'AND', { limit: 'abc' })
      ).rejects.toThrow('Invalid limit: "abc"');
      await expect(
        // @ts-expect-error deliberately passes an object as offset
        model.findWhere([{ id: 1 }], 'AND', { offset: {} })
      ).rejects.toThrow('Invalid offset');
      await expect(
        model.findWhere([{ id: 1 }], 'AND', { limit: -1 })
      ).rejects.toThrow('Invalid limit: -1');
    });

    test('findWhere honors limit: 0 and offset: 0 (suggestion 5)', async () => {
      mockDb.any.mockResolvedValue([]);
      await model.findWhere([{ id: 1 }], 'AND', { limit: 0, offset: 0 });
      const [query] = mockDb.any.mock.calls.at(-1)!;
      expect(query).toContain('LIMIT 0');
      expect(query).toContain('OFFSET 0');
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
      const result = await model.findWhere([
        { $or: [{ id: 1 }, { id: 2 }] },
        { email: { $ilike: '%@x.com' } },
      ]);
      expect(result).toEqual([{ id: 1 }]);
    });

    test('findWhere should return filtered results with nested $or and AND blocks', async () => {
      mockDb.any.mockResolvedValue([{ id: 3 }]);
      const result = await model.findWhere([
        { $or: [{ id: 1 }, { id: 2 }] },
        { $or: [{ email: 'a@x.com' }, { email: 'b@x.com' }] },
        { password: 'secret' },
      ]);
      expect(result).toEqual([{ id: 3 }]);
    });
  });

  describe('Error Handling', () => {
    test('findById should throw on invalid id', async () => {
      // @ts-expect-error deliberately passes null as the id
      await expect(model.findById(null)).rejects.toThrow('Invalid ID format');
    });

    test('exists should throw if conditions is not an object', async () => {
      // @ts-expect-error deliberately passes null as conditions
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
