import { DB } from 'pg-schemata';
import repositories from './repositories.js';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

if (!DB.db) {
  DB.init(DATABASE_URL, repositories);
}

export const db = DB.db;
export const pgp = DB.pgp;