import BaseModel from '../../src/BaseModel.js';

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
    insert: jest.fn(
      (dto, cs) => `INSERT INTO "public"."users" (...) VALUES (...)`
    ),
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
jest.mock('../../src/utils/schemaBuilder', () => ({
  addAuditFields: jest.fn(schema => schema),
  createColumnSet: jest.fn(() => ({
    insert: jest.fn(dto => `INSERT INTO users ... VALUES (...)`),
    update: {},
  })),
  createTableSQL: jest.fn(() => 'CREATE TABLE IF NOT EXISTS public.users (...);'),
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
    model.logQuery = jest.fn();
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

      test('exists should return true or false', async () => {
        mockDb.one.mockResolvedValue({ exists: true });
        const result = await model.exists({ email: 'test@example.com' });
        expect(result).toBe(true);
      });

      test('findBy should return matching records using AND logic', async () => {
        mockDb.any.mockResolvedValue([{ id: 1, email: 'test@example.com' }]);

        const result = await model.findBy([{ id: 1 }, { email: 'test@example.com' }]);

        expect(mockDb.any).toHaveBeenCalled();
        const query = model.logQuery.mock.calls[0][0];
        expect(query).toMatch(/WHERE \("id" = \$1 AND "email" = \$2\)/);
        expect(result).toEqual([{ id: 1, email: 'test@example.com' }]);
      });

      test('findBy should support filters with OR and LIKE logic', async () => {
        mockDb.any.mockResolvedValue([{ id: 2 }]);

        const result = await model.findBy([{ id: 2 }], 'AND', {
          filters: {
            or: [
              { name: { like: '%john%' } },
              { email: { ilike: '%@example.com' } },
            ],
          },
        });

        expect(mockDb.any).toHaveBeenCalled();
        const query = model.logQuery.mock.calls[0][0];
        expect(query).toMatch(/"name" LIKE/);
        expect(query).toMatch(/"email" ILIKE/);
        expect(result).toEqual([{ id: 2 }]);
      });

      test('findOneBy should return the first matching record', async () => {
        mockDb.any.mockResolvedValue([{ id: 3 }]);

        const result = await model.findOneBy([{ id: 3 }]);

        expect(mockDb.any).toHaveBeenCalled();
        expect(result).toEqual({ id: 3 });
      });

      test('findOneBy should return null if no records found', async () => {
        mockDb.any.mockResolvedValue([]);

        const result = await model.findOneBy([{ id: 999 }]);

        expect(mockDb.any).toHaveBeenCalled();
        expect(result).toBeNull();
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

    describe('BaseModel.findAfterCursor', () => {
      test('generates correct query with basic cursor and default options', async () => {
        mockDb.any.mockResolvedValue([{ id: 2, email: 'a@x.com' }]);

        const res = await model.findAfterCursor({ id: 1 }, 10, ['id']);

        expect(mockDb.any).toHaveBeenCalled();
        const query = model.logQuery.mock.calls[0][0];
        expect(query).toMatch(/WHERE \("id"\) > \(\$1\)/);
        expect(query).toMatch(/ORDER BY "id" ASC/);
        expect(res.nextCursor).toEqual({ id: 2 });
      });

      test('applies descending and columnWhitelist options', async () => {
        expect(model.pgp).toBeDefined();
        expect(typeof model.pgp.as.name).toBe('function');
        mockDb.any.mockResolvedValue([{ id: 99 }]);
 
        await model.findAfterCursor({ id: 98 }, 5, ['id'], {
          descending: true,
          columnWhitelist: ['id'],
        });
 
        const query = model.logQuery.mock.calls[0][0];
        expect(query).toContain('SELECT "id" FROM');
        expect(query).toContain('ORDER BY "id" DESC');
      });

      test('handles AND + OR + ILIKE + LIKE + range filters', async () => {
        mockDb.any.mockResolvedValue([{ id: 3 }]);

        await model.findAfterCursor(
          { created_at: '2023-01-01', id: 1 },
          10,
          ['created_at', 'id'],
          {
            filters: {
              and: [
                { status: 'active' },
                {
                  or: [
                    { email: { ilike: '%@test.com' } },
                    { name: { like: '%john%' } },
                  ],
                },
                { created_at: { from: '2022-01-01', to: '2023-12-31' } },
              ],
            },
          }
        );

        const query = model.logQuery.mock.calls[0][0];
        expect(query).toMatch(/"status" =/);
        expect(query).toMatch(/"email" ILIKE/);
        expect(query).toMatch(/"name" LIKE/);
        expect(query).toMatch(/"created_at" >=/);
        expect(query).toMatch(/"created_at" <=/);
        expect(query).toMatch(/AND \(/); // confirms OR block
      });

      test('returns null nextCursor if no rows', async () => {
        mockDb.any.mockResolvedValue([]);
        const res = await model.findAfterCursor({ id: 100 }, 10, ['id']);
        expect(res.nextCursor).toBeNull();
      });

      test('throws if cursor is missing required key', async () => {
        await expect(
          model.findAfterCursor({ wrong_key: 1 }, 10, ['id'])
        ).rejects.toThrow('Missing cursor for id');
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
  // Table Creation
  // ================================
  describe('Table Creation', () => {
    test('createTable should call db.none with generated SQL', async () => {
      const mockSql = 'CREATE TABLE IF NOT EXISTS public.users (...);';
      const mockCreateTableSQL = jest.fn().mockReturnValue(mockSql);
      jest.unstable_mockModule('../../src/utils/schemaBuilder', () => ({
        ...jest.requireActual('../../src/utils/schemaBuilder'),
        createTableSQL: mockCreateTableSQL,
      }));

      const BaseModelWithMock = (await import('../../src/BaseModel.js')).default;
      const testModel = new BaseModelWithMock(mockDb, mockPgp, mockSchema);
      await testModel.createTable();

      expect(mockDb.none).toHaveBeenCalledWith(mockSql);
    });

    test('createTable should call handleDbError on failure', async () => {
      const mockCreateTableSQL = jest.fn().mockReturnValue('CREATE SQL');
      jest.unstable_mockModule('../../src/utils/schemaBuilder', () => ({
        ...jest.requireActual('../../src/utils/schemaBuilder'),
        createTableSQL: mockCreateTableSQL,
      }));

      const BaseModelWithMock = (await import('../../src/BaseModel.js')).default;
      const testModel = new BaseModelWithMock(mockDb, mockPgp, mockSchema);
      const error = new Error('Table creation failed');
      const spy = jest
        .spyOn(testModel, 'handleDbError')
        .mockImplementation(err => {
          throw err;
        });

      mockDb.none.mockRejectedValue(error);
      await expect(testModel.createTable()).rejects.toThrow('Table creation failed');
      expect(spy).toHaveBeenCalledWith(error);
    });
  });

  // ================================
  // Validation Errors
  // ================================
  describe('Validation Errors', () => {
    test('findById should throw if ID is invalid', async () => {
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
