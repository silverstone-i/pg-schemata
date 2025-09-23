import { TableModel } from 'pg-schemata';
import { ordersSchema } from '../schemas/ordersSchema.js';

export class Orders extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, ordersSchema, logger);
  }
}
