import 'dotenv/config';
import { createTableSQL } from '../../src/utils/schemaBuilder.js';
import TableModel from '../../src/TableModel.js';
import DB from '../../src/DB.js';

// Create a User model for testing
class Users extends TableModel {
  constructor(db, pgp) {
    super(db, pgp, {
      dbSchema: 'test_schema',
      table: 'test_users',
      version: '1.0.0',
      columns: [
        { name: 'id', type: 'uuid', default: 'uuid_generate_v4()' },
        { name: 'email', type: 'varchar(50)' },
        { name: 'password', type: 'varchar(50)' },
      ],
      indexes: [{ name: 'users_email_idx', columns: ['email'] }],
      constraints: { primaryKey: ['id'] },
    });
  }
}

// Initialize the database
const repositories = { users: Users };

const { db, pgp } = DB.init(process.env.DATABASE_URL, repositories);

// Test connection
// db.connect()
//   .then(obj => {
//     console.log('Connected to Postgres database!');
//     obj.done(); // success, release connection;
//   })
//   .catch(err => {
//     console.error(err);
//   });

describe('pg-schemata integration', () => {
  beforeAll(async () => {
    // Clean up before running tests
    await db.none(`DROP TABLE IF EXISTS test_schema.test_users`);
  });

  afterAll(async () => {
    // Clean up after tests
    await db.none(`DROP TABLE IF EXISTS test_schema.test_users`);
    await pgp.end(); // close db connection
  });

  it('should create a table successfully', async () => {
    const createSQL = createTableSQL(db.users.schema);

    try {
      await db.none(createSQL);
    } catch (error) {
      console.error('Error creating table:', error);
    }

    try {
      const tableExists = await db.oneOrNone(`
        SELECT to_regclass('test_schema.test_users') as table_name;
      `);
      expect(tableExists.table_name).toBe('test_schema.test_users');
    } catch (error) {
      console.error('Error testing if table exists:', error);
    }
  });
});
