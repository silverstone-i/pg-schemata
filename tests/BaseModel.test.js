import BaseModel from '../src/base/BaseModel'; // adjust path as needed

// ================================
// Mocks
// ================================
const mockDb = {
  one: jest.fn(),
  any: jest.fn(),
  oneOrNone: jest.fn(),
  result: jest.fn(),
  none: jest.fn(),
};

const mockPgp = {
  as: {
    name: jest.fn(name => `"${name}"`),
    format: jest.fn((query, values) => query.replace('$1', values[0])),
  },
  helpers: {
    update: jest.fn(
      (dto, cs, { table, schema }) => `UPDATE "${schema}"."${table}" SET ...`
    ),
  },
};

const mockSchema = {
  dbSchema: 'public',
  table: 'users',
  columns: [{ name: 'id' }, { name: 'email' }, { name: 'password' }],
  constraints: { primaryKey: ['id'] },
};

// Utility mocks
jest.mock('../src/utils/schemaBuilder', () => ({
  addAuditFields: jest.fn(schema => schema),
  createColumnSet: jest.fn(() => ({
    insert: jest.fn(dto => `INSERT INTO users ... VALUES (...)`),
    update: {},
  })),
}));

// ================================
// Shared constants
// ================================
const TEST_ERROR = new Error('db error');

describe('BaseModel', () => {
  let model;
  let spyHandleDbError;

  beforeEach(() => {
    jest.clearAllMocks();
    model = new BaseModel(mockDb, mockPgp, mockSchema);
    spyHandleDbError = jest
      .spyOn(model, 'handleDbError')
      .mockImplementation(err => {
        throw err;
      });
  });

  // ================================
  // Constructor Validation
  // ================================
  describe('Constructor Validation', () => {
    test('should throw if schema is not an object', () => {
      expect(() => new BaseModel(mockDb, mockPgp, 'invalid')).toThrow(
        'Schema must be an object'
      );
    });

    test('should throw if required parameters are missing', () => {
      expect(() => new BaseModel(mockDb, mockPgp, {})).toThrow(
        'Missing one or more required parameters: db, pgp, schema, table and/or primary key constraint'
      );
    });
  });

  // ================================
  // Utility Methods
  // ================================
  describe('Utility Methods', () => {
    test('escapeName should wrap name in quotes', () => {
      expect(model.escapeName('test')).toBe('"test"');
    });

    test('isValidId should validate id correctly', () => {
      expect(model.isValidId(123)).toBe(true);
      expect(model.isValidId('abc')).toBe(true);
      expect(model.isValidId('')).toBe(false);
    });

    test('validateUUID should validate UUID format', () => {
      expect(model.validateUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(
        true
      );
      expect(model.validateUUID('invalid-uuid')).toBe(false);
    });

    test('sanitizeDto should strip invalid fields', () => {
      const sanitized = model.sanitizeDto({
        id: 1,
        email: 'test@example.com',
        invalidField: 'bad',
      });
      expect(sanitized).toEqual({ id: 1, email: 'test@example.com' });
    });
  });

  // ================================
  // CRUD Operations
  // ================================
  describe('CRUD Operations', () => {
    describe('Insert', () => {
      test('should sanitize dto and insert', async () => {
        mockDb.one.mockResolvedValue({ id: 1 });
        const result = await model.insert({ id: 1, email: 'test@example.com' });
        expect(mockDb.one).toHaveBeenCalled();
        expect(result).toEqual({ id: 1 });
      });

      test('should throw if dto has no valid columns', async () => {
        const schemaWithoutValidColumns = {
          dbSchema: 'public',
          table: 'users',
          columns: [{ name: '_id' }],
          constraints: { primaryKey: ['id'] },
        };
        const invalidModel = new BaseModel(
          mockDb,
          mockPgp,
          schemaWithoutValidColumns
        );

        await expect(invalidModel.insert({ invalid: 'field' })).rejects.toThrow(
          'DTO must contain at least one valid column'
        );
      });
    });

    describe('Find', () => {
      test('findAll should return results', async () => {
        mockDb.any.mockResolvedValue([{ id: 1 }]);
        const result = await model.findAll({ limit: 10, offset: 0 });
        expect(result).toEqual([{ id: 1 }]);
      });

      test('findById should return a record', async () => {
        mockDb.oneOrNone.mockResolvedValue({ id: 1 });
        const result = await model.findById(1);
        expect(result).toEqual({ id: 1 });
      });

      test('reload should refetch the record', async () => {
        const spy = jest.spyOn(model, 'findById').mockResolvedValue({ id: 1 });
        const result = await model.reload(1);
        expect(spy).toHaveBeenCalledWith(1);
        expect(result).toEqual({ id: 1 });
      });

      test('findAfterCursor should return records after id', async () => {
        mockDb.any.mockResolvedValue([{ id: 2 }]);
        const result = await model.findAfterCursor(1, 10);
        expect(result).toEqual([{ id: 2 }]);
      });

      test('findBy should return matching records', async () => {
        mockDb.any.mockResolvedValue([{ id: 1 }]);
        const result = await model.findBy({ email: 'test@example.com' });
        expect(result).toEqual([{ id: 1 }]);
      });

      test('findOneBy should return first match or null', async () => {
        mockDb.any.mockResolvedValue([{ id: 1 }]);
        const result = await model.findOneBy({ email: 'test@example.com' });
        expect(result).toEqual({ id: 1 });

        mockDb.any.mockResolvedValue([]);
        const result2 = await model.findOneBy({ email: 'none@example.com' });
        expect(result2).toBeNull();
      });

      test('exists should return true or false', async () => {
        mockDb.one.mockResolvedValue({ exists: true });
        const result = await model.exists({ email: 'test@example.com' });
        expect(result).toBe(true);
      });
    });

    describe('Update', () => {
      test('should update and return result', async () => {
        mockDb.one.mockResolvedValue({ id: 1 });
        const result = await model.update(1, { email: 'updated@example.com' });
        expect(result).toEqual({ id: 1 });
      });
    });

    describe('Delete', () => {
      test('should delete and return result', async () => {
        mockDb.result.mockResolvedValue(1);
        const result = await model.delete(1);
        expect(result).toBe(1);
      });
    });

    describe('Count', () => {
      test('should count rows', async () => {
        mockDb.one.mockResolvedValue({ count: '5' });
        const result = await model.count();
        expect(result).toBe(5);
      });
    });

    describe('Truncate', () => {
      test('should truncate table', async () => {
        mockDb.none.mockResolvedValue();
        await model.truncate();
        expect(mockDb.none).toHaveBeenCalled();
      });
    });
  });

  // ================================
  // Schema Management
  // ================================
  describe('Schema Management', () => {
    test('setSchema should change schema', () => {
      model.setSchema('new_schema');
      expect(model.schema.dbSchema).toBe('new_schema');
    });

    test('withSchema should change schema and return model', () => {
      const returnedModel = model.withSchema('another_schema');
      expect(model.schema.dbSchema).toBe('another_schema');
      expect(returnedModel).toBe(model);
    });
  });

  // ================================
  // Validation Errors
  // ================================
  describe('Validation Errors', () => {
    test('findById should throw if ID is invalid', async () => {
      await expect(model.findById(null)).rejects.toThrow('Invalid ID format');
    });

    test('findAfterCursor should throw if cursor is invalid', async () => {
      await expect(model.findAfterCursor('')).rejects.toThrow(
        'Invalid cursor format'
      );
    });

    test('findBy should throw if conditions is not an object', async () => {
      await expect(model.findBy(null)).rejects.toThrow(
        'Conditions must be a non-empty object'
      );
    });

    test('findBy should throw if conditions is empty', async () => {
      await expect(model.findBy({})).rejects.toThrow(
        'Conditions must be a non-empty object'
      );
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

    test('insert should throw if DTO is not an object', async () => {
      await expect(model.insert('not-an-object')).rejects.toThrow(
        'DTO must be a non-empty object'
      );
    });

    test('insert should throw if DTO is an array', async () => {
      await expect(model.insert([])).rejects.toThrow(
        'DTO must be a non-empty object'
      );
    });

    test('update should throw if ID is invalid', async () => {
      await expect(
        model.update('', { email: 'test@example.com' })
      ).rejects.toThrow('Invalid ID format');
    });

    test('update should throw if DTO is not an object', async () => {
      await expect(model.update(1, 'invalid')).rejects.toThrow(
        'DTO must be a non-empty object'
      );
    });

    test('update should throw if DTO is an array', async () => {
      await expect(model.update(1, [])).rejects.toThrow(
        'DTO must be a non-empty object'
      );
    });

    test('update should throw if DTO is empty', async () => {
      await expect(model.update(1, {})).rejects.toThrow(
        'DTO must be a non-empty object'
      );
    });

    test('delete should throw if ID is invalid', async () => {
      await expect(model.delete('')).rejects.toThrow('Invalid ID format');
    });
  });

  // ================================
  // Logging
  // ================================
  describe('Logging', () => {
    test('logQuery should call logger.debug with the correct query', () => {
      const mockDebug = jest.fn();
      const loggerModel = new BaseModel(mockDb, mockPgp, mockSchema, {
        debug: mockDebug,
      });
      const query = 'SELECT * FROM users';

      loggerModel.logQuery(query);

      expect(mockDebug).toHaveBeenCalledWith(`Running query: ${query}`);
    });
  });

  // ================================
  // Error Handling in CRUD Methods
  // ================================
  describe('Error Handling in CRUD Methods', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('insert should call handleDbError if db.one throws', async () => {
      mockDb.one.mockRejectedValue(TEST_ERROR);

      await expect(
        model.insert({ id: 1, email: 'test@example.com' })
      ).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('findAll should call handleDbError if db.any throws', async () => {
      mockDb.any.mockRejectedValue(TEST_ERROR);

      await expect(model.findAll()).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('findById should call handleDbError if db.oneOrNone throws', async () => {
      mockDb.oneOrNone.mockRejectedValue(TEST_ERROR);

      await expect(model.findById(1)).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('findAfterCursor should call handleDbError if db.any throws', async () => {
      mockDb.any.mockRejectedValue(TEST_ERROR);

      await expect(model.findAfterCursor(1)).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('findBy should call handleDbError if db.any throws', async () => {
      mockDb.any.mockRejectedValue(TEST_ERROR);

      await expect(model.findBy({ email: 'test@example.com' })).rejects.toThrow(
        'db error'
      );
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('findOneBy should call handleDbError if findBy throws', async () => {
      jest.spyOn(model, 'findBy').mockRejectedValue(TEST_ERROR);

      await expect(
        model.findOneBy({ email: 'test@example.com' })
      ).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('exists should call handleDbError if db.one throws', async () => {
      mockDb.one.mockRejectedValue(TEST_ERROR);

      await expect(model.exists({ email: 'test@example.com' })).rejects.toThrow(
        'db error'
      );
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('update should call handleDbError if db.one throws', async () => {
      mockDb.one.mockRejectedValue(TEST_ERROR);

      await expect(
        model.update(1, { email: 'test@example.com' })
      ).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('delete should call handleDbError if db.result throws', async () => {
      mockDb.result.mockRejectedValue(TEST_ERROR);

      await expect(model.delete(1)).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('count should call handleDbError if db.one throws', async () => {
      mockDb.one.mockRejectedValue(TEST_ERROR);

      await expect(model.count()).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });

    test('truncate should call handleDbError if db.none throws', async () => {
      mockDb.none.mockRejectedValue(TEST_ERROR);

      await expect(model.truncate()).rejects.toThrow('db error');
      expect(spyHandleDbError).toHaveBeenCalledWith(TEST_ERROR);
    });
  });

  // ================================
  // handleDbError Method
  // ================================
  describe('handleDbError Method', () => {
    test('should log error and rethrow if logger exists', () => {
      const mockErrorLogger = jest.fn();
      const loggerModel = new BaseModel(mockDb, mockPgp, mockSchema, {
        error: mockErrorLogger,
      });

      const error = new Error('Something went wrong');

      expect(() => loggerModel.handleDbError(error)).toThrow(
        'Something went wrong'
      );
      expect(mockErrorLogger).toHaveBeenCalledWith('Database error:', error);
    });

    test('should rethrow without logging if logger is absent', () => {
      const modelWithoutLogger = new BaseModel(mockDb, mockPgp, mockSchema); // no logger
      const error = new Error('Something went wrong');

      expect(() => modelWithoutLogger.handleDbError(error)).toThrow(
        'Something went wrong'
      );
    });
  });
});
