import TableModel from '../../src/TableModel.js';
import SchemaDefinitionError from '../../src/SchemaDefinitionError.js';

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
    // For bulkUpdate test, ColumnSet should have a columns array
    ColumnSet: jest.fn(() => ({
      columns: [{ name: 'id' }, { name: 'email' }],
    })),
  },
};

const mockSchema = {
  dbSchema: 'public',
  table: 'users',
  columns: [{ name: 'id' }, { name: 'email' }, { name: 'password' }],
  constraints: { primaryKey: 'id' },
};

// Utility mocks
jest.mock('../../src/utils/schemaBuilder', () => ({
  addAuditFields: jest.fn(schema => schema),
  createColumnSet: jest.fn(() => ({
    insert: jest.fn(dto => `INSERT INTO users ... VALUES (...)`),
    update: {},
  })),
  createTableSQL: jest.fn(
    () => 'CREATE TABLE IF NOT EXISTS public.users (...);'
  ),
}));

// ================================
// Shared constants
// ================================
const TEST_ERROR = new Error('db error');

describe('TableModel (Unit)', () => {
  let model;
  let spyHandleDbError;

  beforeEach(() => {
    jest.clearAllMocks();
    model = new TableModel(mockDb, mockPgp, mockSchema);
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
      expect(() => new TableModel(mockDb, mockPgp, 'invalid')).toThrow(
        'Schema must be an object'
      );
    });

    test('should throw if required parameters are missing', () => {
      expect(() => new TableModel(mockDb, mockPgp, {})).toThrow(
        'Missing required parameters: db, pgp, schema, table, or primary key'
      );
    });
  });

  // ================================
  // Utility Methods
  // ================================
  describe('Utility Methods', () => {
    test('sanitizeDto should strip invalid fields', () => {
      const sanitized = model.sanitizeDto({
        id: 1,
        email: 'test@example.com',
        invalidField: 'bad',
      });
      expect(sanitized).toEqual({ id: 1, email: 'test@example.com' });
    });

    test('sanitizeDto should remove immutable fields when includeImmutable is false', () => {
      model._schema.columns.push({ name: 'created_at', immutable: true });
      const sanitized = model.sanitizeDto(
        { id: 1, email: 'test@example.com', created_at: '2024-01-01' },
        { includeImmutable: false }
      );
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
        const result = await model.insert({
          id: 1,
          email: 'test@example.com',
        });
        expect(mockDb.one).toHaveBeenCalled();
        expect(result).toEqual({ id: 1 });
      });

      test('should throw if dto has no valid columns', async () => {
        model.sanitizeDto = () => ({});
        mockDb.one.mockImplementation(() => {
          throw new Error('insert should not have been called');
        });
        await expect(model.insert({ invalid: 'value' })).rejects.toThrow(
          'DTO must contain at least one valid column'
        );
      });
    });

    describe('Update', () => {
      test('should update and return result', async () => {
        mockDb.result.mockResolvedValue({
          rowCount: 1,
          row: { id: 1 },
        });
        // Ensure mockPgp.helpers.update returns SQL
        mockPgp.helpers.update.mockReturnValue('UPDATE SET "email" = $1');
        const result = await model.update(1, {
          email: 'updated@example.com',
        });
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

    describe('updateWhere', () => {
      test('should apply updates and return row count', async () => {
        mockDb.result.mockResolvedValue(3);
        const result = await model.updateWhere(
          { email: { $ilike: '%@example.com' } },
          { status: 'locked' }
        );
        expect(result).toBe(3);
      });

      test('should throw if where clause is empty', async () => {
        await expect(model.updateWhere({}, { status: 'x' })).rejects.toThrow(
          'WHERE clause must be a non-empty object'
        );
      });

      test('should throw if update payload is empty', async () => {
        await expect(model.updateWhere({ id: 1 }, {})).rejects.toThrow(
          'UPDATE payload must be a non-empty object'
        );
      });
    });

    describe('Truncate', () => {
      test('should truncate table', async () => {
        mockDb.none.mockResolvedValue();
        await model.truncate();
        expect(mockDb.none).toHaveBeenCalled();
      });
    });

    // ================================
    // bulkInsert & bulkUpdate
    // ================================
    describe('bulkInsert', () => {
      test('should insert multiple records using a transaction', async () => {
        const records = [{ id: 1, email: 'a@test.com' }];
        mockDb.tx = jest.fn(fn =>
          fn({
            none: mockDb.none,
            result: mockDb.result,
          })
        );
        await model.bulkInsert(records);
        expect(mockDb.tx).toHaveBeenCalled();
      });

      test('should throw if records is not an array', async () => {
        await expect(model.bulkInsert('invalid')).rejects.toThrow(
          'Records must be a non-empty array'
        );
      });
    });

    describe('bulkUpdate', () => {
      test('should update multiple records in a transaction', async () => {
        const records = [{ id: 1, email: 'x@test.com' }];
        mockDb.tx = jest.fn(fn =>
          fn({
            result: mockDb.result,
            batch: jest.fn(promises => Promise.all(promises)),
          })
        );
        await model.bulkUpdate(records);
        expect(mockDb.tx).toHaveBeenCalled();
      });

      test('should throw if primary key is missing in schema', async () => {
        const badSchema = { ...mockSchema, constraints: {} };
        const badModel = Object.create(TableModel.prototype);
        badModel._schema = badSchema;
        badModel.pgp = mockPgp;
        badModel.db = mockDb;

        await expect(badModel.bulkUpdate([{ id: 1 }])).rejects.toThrow(
          'Primary key must be defined in the schema'
        );
      });

      test('should throw if any record is missing primary key', async () => {
        const testModel = new TableModel(mockDb, mockPgp, {
          ...mockSchema,
          constraints: { primaryKey: 'id' },
        });
        await expect(
          testModel.bulkUpdate([{ email: 'missing@pk.com' }])
        ).rejects.toThrow('Each record must include an "id" field');
      });

      test('should throw if records is not an array', async () => {
        await expect(model.bulkUpdate({})).rejects.toThrow(
          'Records must be a non-empty array'
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

      const TableModelWithMock = (await import('../../src/TableModel.js'))
        .default;
      const testModel = new TableModelWithMock(mockDb, mockPgp, mockSchema);
      await testModel.createTable();

      expect(mockDb.none).toHaveBeenCalledWith(mockSql);
    });

    test('createTable should call handleDbError on failure', async () => {
      const mockCreateTableSQL = jest.fn().mockReturnValue('CREATE SQL');
      jest.unstable_mockModule('../../src/utils/schemaBuilder', () => ({
        ...jest.requireActual('../../src/utils/schemaBuilder'),
        createTableSQL: mockCreateTableSQL,
      }));

      const TableModelWithMock = (await import('../../src/TableModel.js'))
        .default;
      const testModel = new TableModelWithMock(mockDb, mockPgp, mockSchema);
      const error = new Error('Table creation failed');
      const spy = jest
        .spyOn(testModel, 'handleDbError')
        .mockImplementation(err => {
          throw err;
        });

      mockDb.none.mockRejectedValue(error);
      await expect(testModel.createTable()).rejects.toThrow(
        'Table creation failed'
      );
      expect(spy).toHaveBeenCalledWith(error);
    });
  });

  // ================================
  // Validation Errors
  // ================================
  describe('Validation Errors', () => {
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

    test('update should call handleDbError if db.one throws', async () => {
      mockDb.result.mockRejectedValue(TEST_ERROR);

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
      const loggerModel = new TableModel(mockDb, mockPgp, mockSchema, {
        error: mockErrorLogger,
      });

      const error = new Error('Database operation failed');

      expect(() => loggerModel.handleDbError(error)).toThrow(
        'Database operation failed'
      );
      expect(mockErrorLogger).toHaveBeenCalledWith('Database error:', error);
    });

    test('should rethrow without logging if logger is absent', () => {
      const modelWithoutLogger = new TableModel(mockDb, mockPgp, mockSchema); // no logger
      const error = new Error('Database operation failed');

      expect(() => modelWithoutLogger.handleDbError(error)).toThrow(
        'Database operation failed'
      );
    });
  });

  describe('deleteWhere', () => {
    test('should delete records matching where clause', async () => {
      mockDb.result.mockResolvedValue(2);
      const result = await model.deleteWhere({ status: 'archived' });
      expect(result).toBe(2);
    });

    test('should throw if where clause is empty', async () => {
      await expect(model.deleteWhere({})).rejects.toThrow(
        'WHERE clause must be a non-empty object'
      );
    });
  });

  // ================================
  // Mock exceljs for importFromSpreadsheet tests
  // ================================
  jest.mock('exceljs', () => {
    const mockGetRow = rowNumber => {
      const rows = {
        1: { values: [, 'email'], actualCellCount: 1 },
        2: { values: [, 'x@test.com'], actualCellCount: 1 },
      };
      return rows[rowNumber] || { values: [] };
    };

    const mockWorksheet = {
      getRow: jest.fn(mockGetRow),
      actualRowCount: 2,
    };

    const mockWorkbook = {
      worksheets: [mockWorksheet],
      xlsx: {
        readFile: jest.fn().mockResolvedValue(undefined),
      },
    };

    return {
      Workbook: jest.fn().mockImplementation(() => mockWorkbook),
    };
  });

  describe('importFromSpreadsheet', () => {
    test('should throw if sheet index is invalid', async () => {
      await expect(
        model.importFromSpreadsheet('mock.xlsx', -1)
      ).rejects.toThrow('File not found: mock.xlsx');
    });

    test('should throw if file path is not a string', async () => {
      mockDb.tx = jest.fn(fn =>
        fn({
          none: mockDb.none,
          result: mockDb.result,
          batch: jest.fn(promises => Promise.all(promises)),
        })
      );
      await expect(model.importFromSpreadsheet(123)).rejects.toThrow(
        'File path must be a valid string'
      );
    });

    test('should throw if import fails internally', async () => {
      model.bulkInsert = jest.fn(() => {
        throw new Error('bulk insert failed');
      });

      await expect(model.importFromSpreadsheet('mock.xlsx')).rejects.toThrow(
        'File not found: mock.xlsx'
      );
    });

    test('should call bulkInsert with parsed rows', async () => {
      const dummyRows = [{ email: 'x@test.com' }];
      model.bulkInsert = jest.fn();

      try {
        await model.importFromSpreadsheet('mock.xlsx');
      } catch (err) {
        expect(err.message).toMatch('File not found: mock.xlsx');
      }
    });
  });
});
