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

  beforeEach(() => {
    jest.clearAllMocks();
    model = new BaseModel(mockDb, mockPgp, mockSchema);
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

  // test('insert should sanitize dto and call db.one', async () => {
  //   mockDb.one.mockResolvedValue({ id: 1 });
  //   const result = await model.insert({ id: 1, email: 'test@example.com' });
  //   expect(mockDb.one).toHaveBeenCalled();
  //   expect(result).toEqual({ id: 1 });
  // });

  // test('findAll should call db.any', async () => {
  //   mockDb.any.mockResolvedValue([{ id: 1 }]);
  //   const result = await model.findAll({ limit: 10, offset: 0 });
  //   expect(mockDb.any).toHaveBeenCalled();
  //   expect(result).toEqual([{ id: 1 }]);
  // });

  // test('findById should call db.oneOrNone', async () => {
  //   mockDb.oneOrNone.mockResolvedValue({ id: 1 });
  //   const result = await model.findById(1);
  //   expect(mockDb.oneOrNone).toHaveBeenCalled();
  //   expect(result).toEqual({ id: 1 });
  // });

  // test('reload should call findById', async () => {
  //   const spy = jest.spyOn(model, 'findById').mockResolvedValue({ id: 1 });
  //   const result = await model.reload(1);
  //   expect(spy).toHaveBeenCalledWith(1);
  //   expect(result).toEqual({ id: 1 });
  // });

  // test('findAfterCursor should call db.any', async () => {
  //   mockDb.any.mockResolvedValue([{ id: 2 }]);
  //   const result = await model.findAfterCursor(1, 10);
  //   expect(mockDb.any).toHaveBeenCalled();
  //   expect(result).toEqual([{ id: 2 }]);
  // });

  // test('findBy should build WHERE clause and call db.any', async () => {
  //   mockDb.any.mockResolvedValue([{ id: 1 }]);
  //   const result = await model.findBy({ email: 'test@example.com' });
  //   expect(mockDb.any).toHaveBeenCalled();
  //   expect(result).toEqual([{ id: 1 }]);
  // });

  // test('findOneBy should return first match or null', async () => {
  //   mockDb.any.mockResolvedValue([{ id: 1 }]);
  //   const result = await model.findOneBy({ email: 'test@example.com' });
  //   expect(result).toEqual({ id: 1 });

  //   mockDb.any.mockResolvedValue([]);
  //   const result2 = await model.findOneBy({ email: 'nonexistent@example.com' });
  //   expect(result2).toBeNull();
  // });

  // test('exists should return true or false', async () => {
  //   mockDb.one.mockResolvedValue({ exists: true });
  //   const result = await model.exists({ email: 'test@example.com' });
  //   expect(result).toBe(true);
  // });

  // test('update should sanitize dto and call db.one', async () => {
  //   mockDb.one.mockResolvedValue({ id: 1 });
  //   const result = await model.update(1, { email: 'updated@example.com' });
  //   expect(mockDb.one).toHaveBeenCalled();
  //   expect(result).toEqual({ id: 1 });
  // });

  // test('delete should call db.result', async () => {
  //   mockDb.result.mockResolvedValue(1);
  //   const result = await model.delete(1);
  //   expect(mockDb.result).toHaveBeenCalled();
  //   expect(result).toBe(1);
  // });

  // test('count should call db.one and parse result', async () => {
  //   mockDb.one.mockResolvedValue({ count: '5' });
  //   const result = await model.count();
  //   expect(result).toBe(5);
  // });

  // test('truncate should call db.none', async () => {
  //   mockDb.none.mockResolvedValue();
  //   await model.truncate();
  //   expect(mockDb.none).toHaveBeenCalled();
  // });

  // test('setSchema should change schema', () => {
  //   model.setSchema('new_schema');
  //   expect(model.schema.dbSchema).toBe('new_schema');
  // });

  // test('withSchema should change schema and return model', () => {
  //   const returned = model.withSchema('another_schema');
  //   expect(model.schema.dbSchema).toBe('another_schema');
  //   expect(returned).toBe(model);
  // });
});
