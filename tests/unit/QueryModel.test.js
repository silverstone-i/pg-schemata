jest.mock('../../src/utils/schemaBuilder', () => ({
  addAuditFields: jest.fn(schema => schema),
  createColumnSet: jest.fn(() => ({
    insert: jest.fn(),
    update: {},
  })),
}));
import QueryModel from '../../src/QueryModel.js';

const mockDb = {
  one: jest.fn(),
  any: jest.fn(),
  oneOrNone: jest.fn(),
};

const mockPgp = {
  as: {
    name: jest.fn(name => `"${name}"`),
    format: jest.fn((query, values) => query.replace('$1', values[0])),
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
    jest.clearAllMocks();
    model = new QueryModel(mockDb, mockPgp, mockSchema);
    model.logQuery = jest.fn();
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

  describe('Read Operations', () => {
    test('findAll should query with limit/offset', async () => {
      mockDb.any.mockResolvedValue([{ id: 1 }]);
      const result = await model.findAll({ limit: 5, offset: 0 });
      expect(result).toEqual([{ id: 1 }]);
    });

    test('findById should return record', async () => {
      mockDb.oneOrNone.mockResolvedValue({ id: 2 });
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

    test('findWhere should throw on empty condition array', async () => {
      await expect(model.findWhere([])).rejects.toThrow(
        'Conditions must be a non-empty array'
      );
    });
  });
});