import { TableModel } from 'pg-schemata';
import { orderItemsSchema } from '../schemas/orderItemsSchema.js';

export class OrderItems extends TableModel {
  constructor(db, pgp, logger = null) {
    super(db, pgp, orderItemsSchema, logger);
  }
}
