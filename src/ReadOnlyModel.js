

'use strict';

import { BaseModel } from './BaseModel.js';

class ReadOnlyModel extends BaseModel {
  constructor(db, pgp, schema) {
    super(db, pgp, schema);
  }

  insert() {
    throw new Error('MethodNotAllowed: This model is read-only');
  }

  update() {
    throw new Error('MethodNotAllowed: This model is read-only');
  }

  remove() {
    throw new Error('MethodNotAllowed: This model is read-only');
  }
}

export default ReadOnlyModel;