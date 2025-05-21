'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

class SchemaDefinitionError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'SchemaDefinitionError';
    this.original = originalError;
  }
}

export default SchemaDefinitionError;