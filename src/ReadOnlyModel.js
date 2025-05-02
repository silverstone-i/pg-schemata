'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

import BaseModel from './BaseModel.js';

class ReadOnlyModel extends BaseModel {
  constructor(db, pgp, schema, logger) {
    super(db, pgp, schema, logger);
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

  createTable() {
    // Skip view creation during table migration
    return Promise.resolve();
  }

  truncate() {
    return Promise.resolve();
  }

  reload() {
    return Promise.resolve();
  }
}

export default ReadOnlyModel;