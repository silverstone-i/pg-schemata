'use strict';

import DB from '../DB.js';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
*/

/**
 * Returns a schema-aware version of a registered model or repository.
 * @param {string|object} modelOrName - The model instance or its name.
 * @param {string} schemaName - The database schema to bind.
 * @returns {object} - The model bound to the given schema.
 */
function callDb(modelOrName, schemaName) {
  const model =
    typeof modelOrName === 'string' ? DB.db[modelOrName] : modelOrName;

  if (!model || typeof model.setSchemaName !== 'function') {
    throw new Error('callDb: provided model is not schema-aware');
  }

  return model.setSchemaName(schemaName);
}

export { callDb };
