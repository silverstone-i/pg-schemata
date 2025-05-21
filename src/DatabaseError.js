'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

class DatabaseError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'DatabaseError';
    this.code = originalError?.code;
    this.detail = originalError?.detail;
    this.constraint = originalError?.constraint;
    this.table = originalError?.table;
    this.original = originalError;
  }
}

export default DatabaseError;
