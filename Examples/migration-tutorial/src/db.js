import { DB } from 'pg-schemata';
import { models } from './models/index.js';

let initialized = false;

export function initDb() {
  if (initialized) return DB;
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  DB.init(DATABASE_URL, models);
  initialized = true;
  return DB;
}
