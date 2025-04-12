'use strict';

require('dotenv').config();
const {
  ConnectionParameterError,
  RepositoriesParameterError,
  DBError,
} = require('../db/errors'); // Import your custom error classes
const DB = require('../db/DB'); // Import the DB class to be tested
const Model = require('../db/Model'); // Import the Model class to be tested

const connection = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};

class Users extends Model {
  constructor(db, pgp) {
    super(db, pgp, {
      tableName: 'users',
      dbSchema: 'public',
      timeStamps: true, // Add time stamps to table - default is true
      columns: {
        email: { type: 'varchar(255)', primaryKey: true },
        password: { type: 'varchar(255)', nullable: false },
        employee_id: { type: 'int4', nullable: false },
        full_name: { type: 'varchar(50)', nullable: false },
        role: { type: 'varchar(25)', nullable: false, default: 'user' },
        active: { type: 'bool', nullable: false, default: true },
      },
    });
  }
}

describe('DB', () => {
  beforeEach(() => {
    // Reset static properties of DB class before each test
    DB.db = undefined;
    DB.pgp = undefined;
  });

  test('should initialize database with valid connection and repositories', () => {
    // Mock required dependencies
    const repositories = {
      users: Users,
    };
    // Call the init method
    const db = DB.init(connection, repositories);

    // Assertions
    expect(db).toBeDefined();
    expect(DB.db).toBeDefined();
    expect(DB.pgp).toBeDefined();
    expect(db.users).toBeDefined();
  });

  test('should throw ConnectionParameterError if connection is undefined', () => {
    // Call the init method with undefined connection
    expect(() => {
      DB.init(undefined, {});
    }).toThrow(ConnectionParameterError);
  });

  test('should throw RepositoriesParameterError if repositories is not a plain object', () => {
    // Call the init method with invalid repositories
    expect(() => {
      DB.init(connection, []);
    }).toThrow(RepositoriesParameterError);
  });

  // Does not reinitialize database if already initialized
  test('should not reinitialize database if already initialized', () => {
    // Mock required dependencies
    const repositories = {
      users: jest.fn(),
    };

    // Mock the already initialized database
    DB.db = 'initialized';
    DB.pgp = 'initialized';

    // Mock the connection variable
    const connection = 'mock connection';

    // Call the init method
    const db = DB.init(connection, repositories);

    // Assertions
    expect(db).toBe('initialized');
    expect(DB.db).toBe('initialized');
    expect(DB.pgp).toBe('initialized');
  });
});
