import { bootstrap } from 'pg-schemata';
import { models } from '../src/models/index.js';

export async function up({ schema }) {
  await bootstrap({ models, schema });
}
