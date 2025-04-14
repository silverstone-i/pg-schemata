import BaseModel from '../src/base/BaseModel'; // adjust path as needed

// Mocks
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
    update: jest.fn((dto, cs, { table, schema }) => {
      return `UPDATE "${schema}"."${table}" SET ...`;
    }),
  },
};

const mockSchema = {
  dbSchema: 'public',
  table: 'users',
  columns: [{ name: 'id' }, { name: 'email' }, { name: 'password' }],
  constraints: {
    primaryKey: ['id'],
  },
};

// Utility mocks
jest.mock('../src/utils/schemaBuilder', () => ({
  addAuditFields: jest.fn(schema => schema),
  createColumnSet: jest.fn(() => ({
    insert: jest.fn(dto => `INSERT INTO users ... VALUES (...)`),
    update: {},
  })),
}));

describe('BaseModel', () => {
  let model;
  let spyHandleDbError;
  const error = new Error('db error');

  beforeEach(() => {
    jest.clearAllMocks();
    model = new BaseModel(mockDb, mockPgp, mockSchema);
    spyHandleDbError = jest
      .spyOn(model, 'handleDbError')
      .mockImplementation(err => {
        throw err;
      });
    jest.clearAllMocks();
  });

  test('should throw error if schema is not an object', () => {
    expect(() => new BaseModel(mockDb, mockPgp, 'null')).toThrow(
      'Schema must be an object'
    );
  });

  test('should throw error if required parameters are missing', () => {
    expect(() => new BaseModel(mockDb, mockPgp, {})).toThrow(
      'Missing one or more required parameters: db, pgp, schema, table and/or primary key constraint'
    );
  });

  test('escapeName should wrap name in quotes', () => {
    expect(model.escapeName('test')).toBe('"test"');
  });

  test('isValidId should validate id correctly', () => {
    expect(model.isValidId(123)).toBe(true);
    expect(model.isValidId('abc')).toBe(true);
    expect(model.isValidId('')).toBe(false);
    expect(model.isValidId(null)).toBe(false);
  });

  test('validateUUID should validate UUID format', () => {
    expect(model.validateUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(
      true
    );
    expect(model.validateUUID('invalid-uuid')).toBe(false);
  });

  test('sanitizeDto should only allow valid columns', () => {
    const sanitized = model.sanitizeDto({
      id: 1,
      email: 'test@example.com',
      invalidField: 'bad',
    });
    expect(sanitized).toEqual({ id: 1, email: 'test@example.com' });
  });

  test('insert should sanitize dto and call db.one', async () => {
    mockDb.one.mockResolvedValue({ id: 1 });
    const result = await model.insert({ id: 1, email: 'test@example.com' });
    expect(mockDb.one).toHaveBeenCalled();
    expect(result).toEqual({ id: 1 });
  });

  test('findAll should call db.any', async () => {
    mockDb.any.mockResolvedValue([{ id: 1 }]);
    const result = await model.findAll({ limit: 10, offset: 0 });
    expect(mockDb.any).toHaveBeenCalled();
    expect(result).toEqual([{ id: 1 }]);
  });

  test('findById should call db.oneOrNone', async () => {
    mockDb.oneOrNone.mockResolvedValue({ id: 1 });
    const result = await model.findById(1);
    expect(mockDb.oneOrNone).toHaveBeenCalled();
    expect(result).toEqual({ id: 1 });
  });

  test('reload should call findById', async () => {
    const spy = jest.spyOn(model, 'findById').mockResolvedValue({ id: 1 });
    const result = await model.reload(1);
    expect(spy).toHaveBeenCalledWith(1);
    expect(result).toEqual({ id: 1 });
  });

  test('findAfterCursor should call db.any', async () => {
    mockDb.any.mockResolvedValue([{ id: 2 }]);
    const result = await model.findAfterCursor(1, 10);
    expect(mockDb.any).toHaveBeenCalled();
    expect(result).toEqual([{ id: 2 }]);
  });

  test('findBy should build WHERE clause and call db.any', async () => {
    mockDb.any.mockResolvedValue([{ id: 1 }]);
    const result = await model.findBy({ email: 'test@example.com' });
    expect(mockDb.any).toHaveBeenCalled();
    expect(result).toEqual([{ id: 1 }]);
  });

  test('findOneBy should return first match or null', async () => {
    mockDb.any.mockResolvedValue([{ id: 1 }]);
    const result = await model.findOneBy({ email: 'test@example.com' });
    expect(result).toEqual({ id: 1 });

    mockDb.any.mockResolvedValue([]);
    const result2 = await model.findOneBy({ email: 'nonexistent@example.com' });
    expect(result2).toBeNull();
  });

  test('exists should return true or false', async () => {
    mockDb.one.mockResolvedValue({ exists: true });
    const result = await model.exists({ email: 'test@example.com' });
    expect(result).toBe(true);
  });

  test('update should sanitize dto and call db.one', async () => {
    mockDb.one.mockResolvedValue({ id: 1 });
    const result = await model.update(1, { email: 'updated@example.com' });
    expect(mockDb.one).toHaveBeenCalled();
    expect(result).toEqual({ id: 1 });
  });

  test('delete should call db.result', async () => {
    mockDb.result.mockResolvedValue(1);
    const result = await model.delete(1);
    expect(mockDb.result).toHaveBeenCalled();
    expect(result).toBe(1);
  });

  test('count should call db.one and parse result', async () => {
    mockDb.one.mockResolvedValue({ count: '5' });
    const result = await model.count();
    expect(result).toBe(5);
  });

  test('truncate should call db.none', async () => {
    mockDb.none.mockResolvedValue();
    await model.truncate();
    expect(mockDb.none).toHaveBeenCalled();
  });

  test('setSchema should change schema', () => {
    model.setSchema('new_schema');
    expect(model.schema.dbSchema).toBe('new_schema');
  });

  test('withSchema should change schema and return model', () => {
    const returned = model.withSchema('another_schema');
    expect(model.schema.dbSchema).toBe('another_schema');
    expect(returned).toBe(model);
  });

  test('isValidId should return false for null', () => {
    expect(model.isValidId(null)).toBe(false);
  });

  test('isValidId should return false for undefined', () => {
    expect(model.isValidId(undefined)).toBe(false);
  });

  test('isValidId should return false for an empty string', () => {
    expect(model.isValidId('')).toBe(false);
  });

  test('isValidId should return false for a string with only spaces', () => {
    expect(model.isValidId('   ')).toBe(false);
  });

  test('isValidId should return false for an object', () => {
    expect(model.isValidId({})).toBe(false);
  });

  test('isValidId should return false for an array', () => {
    expect(model.isValidId([])).toBe(false);
  });

  test('isValidId should return false for a boolean value', () => {
    expect(model.isValidId(true)).toBe(false);
    expect(model.isValidId(false)).toBe(false);
  });

  test('isValidId should return false for a NaN value', () => {
    expect(model.isValidId(NaN)).toBe(false);
  });

  test('isValidId should return false for a function', () => {
    expect(model.isValidId(() => {})).toBe(false);
  });

  test('isValidId should return false for a symbol', () => {
    expect(model.isValidId(Symbol('id'))).toBe(false);
  });

  test('should throw error if schema is not an object', () => {
    expect(() => new BaseModel(mockDb, mockPgp, null)).toThrow(
      'Schema must be an object'
    );
  });

  test('should throw error if required parameters are missing', () => {
    expect(() => new BaseModel(mockDb, mockPgp, {})).toThrow(
      'Missing one or more required parameters'
    );
  });

  test('findById should throw error for invalid id', async () => {
    await expect(model.findById(null)).rejects.toThrow('Invalid ID format');
  });

  test('findAfterCursor should throw error for invalid cursor', async () => {
    await expect(model.findAfterCursor('')).rejects.toThrow(
      'Invalid cursor format'
    );
  });

  test('findBy should throw error if conditions is not an object', async () => {
    await expect(model.findBy(null)).rejects.toThrow(
      'Conditions must be a non-empty object'
    );
  });

  test('findBy should throw error if conditions is an empty object', async () => {
    await expect(model.findBy({})).rejects.toThrow(
      'Conditions must be a non-empty object'
    );
  });

  test('exists should throw error if conditions is not an object', async () => {
    await expect(model.exists(null)).rejects.toThrow(
      'Conditions must be a non-empty object'
    );
  });

  test('exists should throw error if conditions is an empty object', async () => {
    await expect(model.exists({})).rejects.toThrow(
      'Conditions must be a non-empty object'
    );
  });

  test('insert should throw error if dto is not an object', async () => {
    await expect(model.insert('not an object')).rejects.toThrow(
      'DTO must be a non-empty object'
    );
  });

  test('insert should throw error if dto is an array', async () => {
    await expect(model.insert([])).rejects.toThrow(
      'DTO must be a non-empty object'
    );
  });

  test('update should throw error for invalid id', async () => {
    await expect(
      model.update('', { email: 'test@example.com' })
    ).rejects.toThrow('Invalid ID format');
  });

  test('update should throw error if dto is not an object', async () => {
    await expect(model.update(1, 'invalid')).rejects.toThrow(
      'DTO must be a non-empty object'
    );
  });

  test('update should throw error if dto is an array', async () => {
    await expect(model.update(1, [])).rejects.toThrow(
      'DTO must be a non-empty object'
    );
  });

  test('update should throw error if dto is an empty object', async () => {
    await expect(model.update(1, {})).rejects.toThrow(
      'DTO must be a non-empty object'
    );
  });

  test('delete should throw error for invalid id', async () => {
    await expect(model.delete('')).rejects.toThrow('Invalid ID format');
  });

  test('logQuery should call logger.debug with the correct query', () => {
    const mockDebug = jest.fn();
    const mockLogger = { debug: mockDebug };

    const loggerModel = new BaseModel(mockDb, mockPgp, mockSchema, mockLogger);
    const testQuery = 'SELECT * FROM users';

    loggerModel.logQuery(testQuery);

    expect(mockDebug).toHaveBeenCalledWith(`Running query: ${testQuery}`);
  });

  test('insert should throw error if dto has no valid columns', async () => {
    const mockLogger = { debug: jest.fn() };
    const inValidSchema = {
      dbSchema: 'public',
      table: 'users',
      columns: [{ name: '_id' }, { name: '_email' }, { name: '_password' }],
      constraints: {
        primaryKey: ['id'],
      },
    };
    const model = new BaseModel(mockDb, mockPgp, inValidSchema, mockLogger);

    const invalidDto = { notARealColumn: 'some value' }; // Not in schema.columns

    await expect(model.insert(invalidDto)).rejects.toThrow(
      'DTO must contain at least one valid column'
    );
  });

  test('insert should call handleDbError if db.one throws', async () => {
    mockDb.one.mockRejectedValue(error);

    await expect(
      model.insert({ id: 1, email: 'test@example.com' })
    ).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('findAll should call handleDbError if db.any throws', async () => {
    mockDb.any.mockRejectedValue(error);

    await expect(model.findAll()).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('findById should call handleDbError if db.oneOrNone throws', async () => {
    mockDb.oneOrNone.mockRejectedValue(error);

    await expect(model.findById(1)).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('findAfterCursor should call handleDbError if db.any throws', async () => {
    mockDb.any.mockRejectedValue(error);

    await expect(model.findAfterCursor(1)).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('findBy should call handleDbError if db.any throws', async () => {
    mockDb.any.mockRejectedValue(error);

    await expect(model.findBy({ email: 'test@example.com' })).rejects.toThrow(
      'db error'
    );
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('findOneBy should call handleDbError if findBy throws', async () => {
    // findOneBy calls findBy internally, so mock findBy
    jest.spyOn(model, 'findBy').mockRejectedValue(error);

    await expect(
      model.findOneBy({ email: 'test@example.com' })
    ).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('exists should call handleDbError if db.one throws', async () => {
    mockDb.one.mockRejectedValue(error);

    await expect(model.exists({ email: 'test@example.com' })).rejects.toThrow(
      'db error'
    );
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('update should call handleDbError if db.one throws', async () => {
    mockDb.one.mockRejectedValue(error);

    await expect(
      model.update(1, { email: 'test@example.com' })
    ).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('delete should call handleDbError if db.result throws', async () => {
    mockDb.result.mockRejectedValue(error);

    await expect(model.delete(1)).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('count should call handleDbError if db.one throws', async () => {
    mockDb.one.mockRejectedValue(error);

    await expect(model.count()).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('truncate should call handleDbError if db.none throws', async () => {
    mockDb.none.mockRejectedValue(error);

    await expect(model.truncate()).rejects.toThrow('db error');
    expect(spyHandleDbError).toHaveBeenCalledWith(error);
  });

  test('handleDbError should call logger.error and rethrow error if logger exists', () => {
    const mockErrorLogger = jest.fn();
    const mockLogger = { error: mockErrorLogger };
    const model = new BaseModel(mockDb, mockPgp, mockSchema, mockLogger);

    const error = new Error('Something went wrong');

    expect(() => model.handleDbError(error)).toThrow('Something went wrong');
    expect(mockErrorLogger).toHaveBeenCalledWith('Database error:', error);
  });

  test('handleDbError should rethrow error without calling logger if logger does not exist', () => {
    const model = new BaseModel(mockDb, mockPgp, mockSchema); // no logger

    const error = new Error('Something went wrong');

    expect(() => model.handleDbError(error)).toThrow('Something went wrong');
    // no logger, nothing to assert about logging
  });
});
