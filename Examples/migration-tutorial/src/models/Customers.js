import { TableModel } from 'pg-schemata';
import { customersSchema } from '../schemas/customersSchema.js';

export class Customers extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, customersSchema, logger);
  }
}
