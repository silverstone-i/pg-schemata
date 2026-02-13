'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import QueryModel from './QueryModel.js';
import SchemaDefinitionError from './SchemaDefinitionError.js';
import { createTableSQL } from './utils/schemaBuilder.js';
import ExcelJS from '@nap-sft/xlsxjs';
import { isValidId, isPlainObject } from './utils/validation.js';
import { logMessage } from './utils/pg-util.js';
import { generateZodFromTableSchema } from './utils/generateZodValidator.js';
import { getAuditActor } from './auditActorResolver.js';

/**
 * TableModel extends QueryModel to provide full read/write support for a PostgreSQL table.
 *
 * Adds create, update, and delete capabilities on top of the read-only features in QueryModel,
 * along with support for spreadsheet import/export, validation, and conditional mutations.
 *
 * ✅ Features:
 * - Full CRUD: `insert`, `update`, `delete`, `deleteWhere`, `updateWhere`
 * - Cursor-based and paginated queries via `findAfterCursor`
 * - Bulk operations: `bulkInsert`, `bulkUpdate`
 * - Data import/export: `importFromSpreadsheet`, `exportToSpreadsheet`
 * - Auto Zod schema validation and field sanitization
 *
 * This class is the standard entry point for interacting with a single table in pg-schemata.
 */
class TableModel extends QueryModel {
  constructor(db, pgp, schema, logger) {
    if (!schema.constraints?.primaryKey) {
      throw new SchemaDefinitionError('Primary key must be defined in the schema');
    }

    super(db, pgp, schema, logger);

    // Determine default value for audit user fields based on schema configuration
    // Use the schema's userFields.default if provided, otherwise fall back to null
    const auditConfig = this._schema.hasAuditFields;
    if (typeof auditConfig === 'object' && auditConfig.enabled) {
      // Use explicit default from schema, or null if not specified
      this._auditUserDefault = auditConfig.userFields?.default ?? null;
    } else if (auditConfig === true) {
      // Boolean format: use 'system' for backward compatibility
      this._auditUserDefault = 'system';
    } else {
      this._auditUserDefault = null;
    }

    // Auto-generate Zod validators if not provided
    if (!this._schema.validators) {
      this._schema.validators = generateZodFromTableSchema(this._schema);
    }
  }

  /**
   * Resolves the current audit actor.  Priority:
   * 1. auditActorResolver callback (if registered and returns non-null)
   * 2. _auditUserDefault (static fallback from schema config)
   *
   * @returns {string|null}
   * @private
   */
  _resolveAuditActor() {
    return getAuditActor() ?? this._auditUserDefault;
  }

  /**
   * Inserts a single row into the table after validation and sanitization.
   * @param {Object} dto - Data to insert.
   * @returns {Promise<Object>} The inserted row.
   * @throws {SchemaDefinitionError} If validation fails or DTO is invalid.
   */
  async insert(dto) {
    if (!isPlainObject(dto)) {
      return Promise.reject(new SchemaDefinitionError('DTO must be a non-empty object'));
    }
    // Zod validation if available
    try {
      if (this._schema.validators?.insertValidator) {
        this._schema.validators.insertValidator.parse(dto);
      }
    } catch (err) {
      const error = new SchemaDefinitionError('DTO validation failed');

      error.cause = err.errors || err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error(`DTO validation failed: ${error.message}`, { cause: error.cause });
      }

      // Return a rejected promise with the error
      return Promise.reject(error);
    }

    // Sanitize the DTO to include only valid columns
    const safeDto = this.sanitizeDto(dto);
    if (Object.keys(safeDto).length === 0) {
      return Promise.reject(new SchemaDefinitionError('DTO must contain at least one valid column'));
    }
    if (this._schema.hasAuditFields && !Object.prototype.hasOwnProperty.call(safeDto, 'created_by')) {
      safeDto.created_by = this._resolveAuditActor();
    }
    let query;
    try {
      query = this.pgp.helpers.insert(safeDto, this.cs.insert) + ' RETURNING *';
    } catch (err) {
      const error = new Error('Failed to construct insert query');
      error.cause = err;
      return Promise.reject(error);
    }
    try {
      return await this.db.one(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Deletes a record by its ID.
   * @param {string|number} id - Primary key of the row to delete.
   * @returns {Promise<number>} Number of rows deleted.
   * @throws {Error} If the ID is invalid or deletion fails.
   */
  async delete(id) {
    if (!isValidId(id)) {
      return Promise.reject(new Error('Invalid ID format'));
    }
    const softCheck = this._schema.softDelete ? ' AND deactivated_at IS NULL' : '';
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE id = $1${softCheck}`;
    try {
      return await this.db.result(query, [id], r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Updates a record by ID with new data.
   * @param {string|number} id - Primary key value.
   * @param {Object} dto - Updated values.
   * @returns {Promise<Object|null>} Updated record or null if not found.
   * @throws {SchemaDefinitionError} If ID or DTO is invalid.
   */
  async update(id, dto) {
    if (!isValidId(id)) {
      return Promise.reject(new SchemaDefinitionError('Invalid ID format'));
    }
    if (typeof dto !== 'object' || Array.isArray(dto) || Object.keys(dto).length === 0) {
      return Promise.reject(new SchemaDefinitionError('DTO must be a non-empty object'));
    }
    try {
      if (this._schema.validators?.updateValidator) {
        this._schema.validators.updateValidator.parse(dto);
      }
    } catch (err) {
      const error = new SchemaDefinitionError('DTO validation failed');

      error.cause = err.errors || err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error(`DTO validation failed: ${error.message}`, { cause: error.cause });
      }

      // Return a rejected promise with the error
      return Promise.reject(error);
    }
    const safeDto = this.sanitizeDto(dto, { includeImmutable: false });
    if (this._schema.hasAuditFields && !Object.prototype.hasOwnProperty.call(safeDto, 'updated_by')) {
      safeDto.updated_by = this._resolveAuditActor();
    }
    const softCheck = this._schema.softDelete ? ' AND deactivated_at IS NULL' : '';
    const condition = this.pgp.as.format('WHERE id = $1', [id]) + softCheck;
    const query =
      this.pgp.helpers.update(safeDto, this.cs.update, {
        schema: this.schema.dbSchema,
        table: this.schema.table,
      }) +
      ' ' +
      condition +
      ' RETURNING *';
    try {
      const result = await this.db.result(query, undefined, r => ({
        rowCount: r.rowCount,
        row: r.rows?.[0] ?? null,
      }));
      return result.rowCount ? result.row : null;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Inserts a record or updates it if it conflicts with specified columns.
   * @param {Object} dto - Data to insert or update.
   * @param {Array<string>} conflictColumns - Columns that define the conflict constraint.
   * @param {Array<string>} [updateColumns] - Columns to update on conflict. Defaults to all non-conflict columns.
   * @returns {Promise<Object>} The inserted or updated row.
   */
  async upsert(dto, conflictColumns, updateColumns = null) {
    if (!isPlainObject(dto)) {
      throw new SchemaDefinitionError('DTO must be a non-empty object');
    }
    if (!Array.isArray(conflictColumns) || conflictColumns.length === 0) {
      throw new SchemaDefinitionError('Conflict columns must be a non-empty array');
    }

    const safeDto = this.sanitizeDto(dto);
    if (this._schema.hasAuditFields) {
      if (!Object.prototype.hasOwnProperty.call(safeDto, 'created_by')) {
        safeDto.created_by = this._resolveAuditActor();
      }
      if (!Object.prototype.hasOwnProperty.call(safeDto, 'updated_by')) {
        safeDto.updated_by = safeDto.created_by;
      }
    }

    const insertCs = new this.pgp.helpers.ColumnSet(Object.keys(safeDto), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const auditExclude = this._schema.hasAuditFields ? ['created_at', 'created_by', 'updated_at', 'updated_by'] : [];
    const columnsToUpdate = (updateColumns || Object.keys(safeDto).filter(col => !conflictColumns.includes(col) && col !== 'id'))
      .filter(col => !auditExclude.includes(col));

    const auditUpdate = this._schema.hasAuditFields ? 'updated_at = NOW(), updated_by = EXCLUDED.updated_by' : '';
    const setParts = [
      ...(columnsToUpdate.length ? [columnsToUpdate.map(col => `${col} = EXCLUDED.${col}`).join(', ')] : []),
      ...(auditUpdate ? [auditUpdate] : []),
    ];

    if (setParts.length === 0) {
      throw new SchemaDefinitionError('No columns available for update on conflict');
    }

    const query = `
      ${this.pgp.helpers.insert(safeDto, insertCs)}
      ON CONFLICT (${conflictColumns.join(', ')})
      DO UPDATE SET ${setParts.join(', ')}
      RETURNING *
    `;

    try {
      return await this.db.one(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Bulk upsert multiple records in a single transaction.
   * @param {Array<Object>} records - Array of records to upsert.
   * @param {Array<string>} conflictColumns - Columns that define the conflict constraint.
   * @param {Array<string>} [updateColumns] - Columns to update on conflict. Defaults to all non-conflict columns.
   * @param {Array<string>|null} [returning=null] - Optional array of columns to return.
   * @returns {Promise<number|Array>} Number of rows affected or array of rows if returning specified.
   */
  async bulkUpsert(records, conflictColumns, updateColumns = null, returning = null) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }
    if (!Array.isArray(conflictColumns) || conflictColumns.length === 0) {
      throw new SchemaDefinitionError('Conflict columns must be a non-empty array');
    }
    if (returning !== null && !Array.isArray(returning)) {
      throw new SchemaDefinitionError('Expected returning to be an array of column names');
    }

    const safeRecords = records.map(dto => {
      const sanitized = this.sanitizeDto(dto);
      if (this._schema.hasAuditFields) {
        if (!Object.prototype.hasOwnProperty.call(sanitized, 'created_by')) {
          sanitized.created_by = this._resolveAuditActor();
        }
        if (!Object.prototype.hasOwnProperty.call(sanitized, 'updated_by')) {
          sanitized.updated_by = sanitized.created_by;
        }
      }
      return sanitized;
    });

    const insertCs = new this.pgp.helpers.ColumnSet(Object.keys(safeRecords[0]), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const auditExclude = this._schema.hasAuditFields ? ['created_at', 'created_by', 'updated_at', 'updated_by'] : [];
    const columnsToUpdate = (updateColumns || Object.keys(safeRecords[0]).filter(col => !conflictColumns.includes(col) && col !== 'id'))
      .filter(col => !auditExclude.includes(col));

    const auditUpdate = this._schema.hasAuditFields ? 'updated_at = NOW(), updated_by = EXCLUDED.updated_by' : '';
    const setParts = [
      ...(columnsToUpdate.length ? [columnsToUpdate.map(col => `${col} = EXCLUDED.${col}`).join(', ')] : []),
      ...(auditUpdate ? [auditUpdate] : []),
    ];

    if (setParts.length === 0) {
      throw new SchemaDefinitionError('No columns available for update on conflict');
    }

    const returningClause = returning ? ` RETURNING ${returning.join(', ')}` : '';

    const query = `
      ${this.pgp.helpers.insert(safeRecords, insertCs)}
      ON CONFLICT (${conflictColumns.join(', ')})
      DO UPDATE SET ${setParts.join(', ')}
      ${returningClause}
    `;

    try {
      return await this.db.tx(async t => {
        if (returning) {
          return await t.any(query);
        }
        return await t.result(query, [], r => r.rowCount);
      });
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🟤 Conditional Mutations
  // ---------------------------------------------------------------------------

  /**
   * Deletes rows matching a WHERE clause.
   * @param {Object|Array} where - Filter criteria.
   * @returns {Promise<number>} Number of rows deleted.
   */
  async deleteWhere(where) {
    let { clause, values } = this.buildWhereClause(where);
    if (this._schema.softDelete) {
      const softCheck = 'deactivated_at IS NULL';
      const prefix = clause ? `${clause} AND ` : '';
      clause = `${prefix}${softCheck}`;
    }
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    try {
      return await this.db.result(query, values, r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Updates only the updated_by timestamp for a given row.
   * @param {string|number} id - Primary key.
   * @param {string} updatedBy - User performing the update.
   * @returns {Promise<Object|null>} Updated row.
   */
  async touch(id, updatedBy = null) {
    // Route through update(), which already applies soft delete check
    const effectiveUpdatedBy = updatedBy ?? this._resolveAuditActor();
    return this.update(id, effectiveUpdatedBy ? { updated_by: effectiveUpdatedBy } : {});
  }

  /**
   * Updates rows matching a WHERE clause.
   * @param {Object|Array} where - Conditions.
   * @param {Object} updates - Fields to update.
   * @param {Object} [options={}] - Additional options (e.g., includeDeactivated).
   * @returns {Promise<number>} Number of rows updated.
   * @throws {SchemaDefinitionError} If input is invalid.
   */
  async updateWhere(where, updates, options = {}) {
    const { includeDeactivated = false } = options;

    const isNonEmpty = val => (Array.isArray(val) ? val.length > 0 : isPlainObject(val) ? Object.keys(val).length > 0 : false);

    if (!isNonEmpty(where)) {
      throw new SchemaDefinitionError('WHERE clause must be a non-empty object or non-empty array');
    }

    if (!isNonEmpty(updates)) {
      throw new SchemaDefinitionError('UPDATE payload must be a non-empty object');
    }

    try {
      if (this._schema.validators?.updateValidator) {
        this._schema.validators.updateValidator.parse(updates);
      }
    } catch (err) {
      const error = new SchemaDefinitionError('DTO validation failed');

      error.cause = err.errors || err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error(`DTO validation failed: ${error.message}`, { cause: error.cause });
      }

      // Return a rejected promise with the error
      return Promise.reject(error);
    }

    const safeUpdates = this.sanitizeDto(updates, { includeImmutable: false });

    if (this._schema.hasAuditFields && !Object.prototype.hasOwnProperty.call(safeUpdates, 'updated_by')) {
      safeUpdates.updated_by = this._resolveAuditActor();
    }
    const updateCs = new this.pgp.helpers.ColumnSet(Object.keys(safeUpdates), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const setClause = this.pgp.helpers.update(safeUpdates, updateCs);

    let { clause, values } = this.buildWhereClause(where, true, [], 'AND', includeDeactivated);

    const query = `${setClause} WHERE ${clause}`;
    try {
      const result = await this.db.result(query, values, r => r.rowCount);
      return result;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🔵 Bulk Operations
  // ---------------------------------------------------------------------------
  /**
   * Inserts many rows in a single batch operation, with optional RETURNING support.
   * @param {Object[]} records - Rows to insert.
   * @param {Array<string>|null} [returning=null] - Optional array of columns to return.
   * @returns {Promise<number|Object[]>} Number of rows inserted, or array of rows if returning specified.
   * @throws {SchemaDefinitionError} If records or returning are invalid.
   */
  async bulkInsert(records, returning = null) {
    const tx = this.tx ?? null;
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }

    if (returning !== null && !Array.isArray(returning)) {
      throw new SchemaDefinitionError('Expected returning to be an array of column names');
    }

    // Validate records
    if (this._schema.validators?.insertValidator) {
      this.validateDto(records, this._schema.validators.insertValidator, 'Insert DTO');
    }

    const safeRecords = records.map(dto => {
      const sanitized = this.sanitizeDto(dto);
      if (this._schema.hasAuditFields && !Object.prototype.hasOwnProperty.call(sanitized, 'created_by')) {
        sanitized.created_by = this._resolveAuditActor();
      }
      return sanitized;
    });

    if (this._schema.softDelete) {
      for (const record of safeRecords) {
        if ('deactivated_at' in record) {
          throw new SchemaDefinitionError('Cannot insert records with deactivated_at when softDelete is enabled');
        }
      }
    }

    const cs = new this.pgp.helpers.ColumnSet(Object.keys(safeRecords[0]), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const query = this.pgp.helpers.insert(safeRecords, cs) + (Array.isArray(returning) && returning.length > 0 ? ` RETURNING ${returning.join(', ')}` : '');

    try {
      if (tx) {
        if (returning) {
          return await tx.any(query);
        }
        return await tx.result(query, [], r => r.rowCount);
      } else {
        return await this.db.tx(async t => {
          if (returning) {
            return await t.any(query);
          }
          return await t.result(query, [], r => r.rowCount);
        });
      }
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Updates multiple rows using their primary keys.
   * @param {Object[]} records - Each must include an ID field.
   * @param {Array<string>|null} [returning=null] - Optional array of columns to return.
   * @returns {Promise<Array>} Array of row counts or updated rows per query.
   * @throws {SchemaDefinitionError} If input or IDs are invalid.
   */
  async bulkUpdate(records, returning = null) {
    const tx = this.tx ?? null;
    const pk = this._schema.constraints?.primaryKey;
    if (!pk) {
      throw new SchemaDefinitionError('Primary key must be defined in the schema');
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }

    if (returning !== null && !Array.isArray(returning)) {
      throw new SchemaDefinitionError('Expected returning to be an array of column names');
    }

    if (this._schema.validators?.updateValidator) {
      this.validateDto(records, this._schema.validators.updateValidator, 'Update DTO');
    }

    const queries = records.map(dto => {
      const id = dto.id;
      if (!isValidId(id)) {
        throw new SchemaDefinitionError(`Invalid ID in record: ${JSON.stringify(dto)}`);
      }
      const safeDto = this.sanitizeDto(dto, { includeImmutable: false });
      if (this._schema.hasAuditFields && !Object.prototype.hasOwnProperty.call(safeDto, 'updated_by')) {
      safeDto.updated_by = this._resolveAuditActor();
    }
      delete safeDto.id;
      const softCheck = this._schema.softDelete ? ' AND deactivated_at IS NULL' : '';
      const condition = this.pgp.as.format('WHERE id = $1', [id]) + softCheck;
      const updateCs = new this.pgp.helpers.ColumnSet(Object.keys(safeDto), {
        table: { table: this._schema.table, schema: this._schema.dbSchema },
      });
      const returningClause = returning ? ` RETURNING ${returning.join(', ')}` : '';
      return {
        query: this.pgp.helpers.update(safeDto, updateCs) + ' ' + condition + returningClause,
        id,
      };
    });

    try {
      if (tx) {
        return await tx.batch(queries.map(q => (returning ? tx.any(q.query, [q.id]) : tx.result(q.query, [q.id], r => r.rowCount))));
      } else {
        return await this.db.tx(async t => t.batch(queries.map(q => (returning ? t.any(q.query, [q.id]) : t.result(q.query, [q.id], r => r.rowCount)))));
      }
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Loads data from an Excel file and inserts it into the table.
   * Each row can be transformed using an optional callback before insertion.
   *
   * @param {string} filePath - Source .xlsx file path.
   * @param {number} [sheetIndex=0] - Sheet index to load.
   * @param {(row: Object) => Object} [callbackFn=null] - Optional function to transform each row before insert.
   * @returns {Promise<{inserted: number}>} Number of rows inserted.
   * @throws {SchemaDefinitionError} If file format is invalid or spreadsheet is empty.
   */
  async importFromSpreadsheet(filePath, sheetIndex = 0, callbackFn = null, returning = null) {
    if (typeof filePath !== 'string') {
      throw new SchemaDefinitionError('File path must be a valid string');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[sheetIndex];

    if (!worksheet) {
      throw new SchemaDefinitionError(`Sheet index ${sheetIndex} is out of bounds. Found ${workbook.worksheets.length} sheets.`);
    }

    const rows = [];
    let headers = [];

    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const values = row.values;

      if (rowNumber === 1) {
        headers = values.slice(1); // skip the empty 0 index
        continue;
      }

      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = values[i + 1];
      });

      const transformed = callbackFn ? await callbackFn(obj) : obj;
      rows.push(transformed);
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new SchemaDefinitionError('Spreadsheet is empty or invalid format');
    }

    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: `Importing ${rows.length} records from spreadsheet`,
    });

    // If softDelete is enabled, strip deactivated_at from rows before bulkInsert
    if (this._schema.softDelete) {
      for (const row of rows) {
        delete row.deactivated_at;
      }
    }

    const inserted = await this.bulkInsert(rows, returning);

    return { inserted };
  }

  // ---------------------------------------------------------------------------
  // 🔻 Soft Delete Management
  // ---------------------------------------------------------------------------

  /**
   * Soft deletes records matching a WHERE clause by setting deactivated_at = NOW().
   * @param {Object|Array} where - Filter criteria.
   * @returns {Promise<number>} Number of rows updated.
   */
  async removeWhere(where) {
    if (!this._schema.softDelete) {
      const error = new Error('Soft delete is not enabled for this table. Let the client decide if the record should be deleted instead.');
      error.status = 403;
      return Promise.reject(error);
    }
    let { clause, values } = this.buildWhereClause(where);
    const softCheck = 'deactivated_at IS NULL';
    const prefix = clause ? `${clause} AND ` : '';
    clause = `${prefix}${softCheck}`;

    let setClause = 'deactivated_at = NOW()';
    if (this._schema.hasAuditFields) {
      const actor = this._resolveAuditActor();
      if (actor != null) {
        values.push(actor);
        setClause += `, updated_by = $${values.length}, updated_at = NOW()`;
      }
    }

    const query = `UPDATE ${this.schemaName}.${this.tableName} SET ${setClause} WHERE ${clause}`;
    return this.db.result(query, values, r => r.rowCount);
  }

  /**
   * Restores previously soft-deleted records by setting deactivated_at = NULL.
   * @param {Object|Array} where - Filter criteria.
   * @returns {Promise<number>} Number of rows updated.
   */
  async restoreWhere(where) {
    if (!this._schema.softDelete) {
      return Promise.reject(new Error('Soft delete is not enabled for this table.'));
    }
    const { clause, values } = this.buildWhereClause(where, true, [], 'AND', true);

    let setClause = 'deactivated_at = NULL';
    if (this._schema.hasAuditFields) {
      const actor = this._resolveAuditActor();
      if (actor != null) {
        values.push(actor);
        setClause += `, updated_by = $${values.length}, updated_at = NOW()`;
      }
    }

    const query = `UPDATE ${this.schemaName}.${this.tableName} SET ${setClause} WHERE ${clause}`;
    return this.db.result(query, values, r => r.rowCount);
  }

  /**
   * Permanently deletes soft-deleted records that match a given condition.
   * Useful for scheduled cleanup of records older than a threshold.
   * @param {Object|Array<Object>} where - Filter conditions.
   * @returns {Promise<Object>} pg-promise result.
   */
  async purgeSoftDeleteWhere(where = []) {
    if (!this._schema.softDelete) {
      return Promise.reject(new Error('Soft delete is not enabled for this table.'));
    }
    const normalized = Array.isArray(where) ? where : [where];
    const { clause, values } = this.buildWhereClause([...normalized, { deactivated_at: { $not: null } }], true, [], 'AND', true);
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    return this.db.result(query, values);
  }

  /**
   * Permanently deletes a soft-deleted row by ID.
   * @param {string|number} id - Primary key value.
   * @returns {Promise<Object>} pg-promise result.
   */
  async purgeSoftDeleteById(id) {
    if (!this._schema.softDelete) {
      return Promise.reject(new Error('Soft delete is not enabled for this table.'));
    }
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.purgeSoftDeleteWhere([{ id }]);
  }

  // ---------------------------------------------------------------------------
  // 🟣 Utilities
  // ---------------------------------------------------------------------------

  /**
   * Truncates the table and resets its identity sequence.
   * @returns {Promise<void>}
   */
  async truncate() {
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Truncating table',
    });
    const query = `TRUNCATE TABLE ${this.schemaName}.${this.tableName} RESTART IDENTITY CASCADE`;
    try {
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Creates the table using the current schema definition.
   * Automatically creates any indexes defined in the schema constraints.
   * @returns {Promise<void>}
   */
  async createTable() {
    const hasIndexes = this._schema.constraints?.indexes?.length > 0;
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: hasIndexes ? 'Creating table with indexes from schema' : 'Creating table from schema',
    });
    try {
      const query = createTableSQL(this._schema, this.logger);
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }
}

export default TableModel;
export { TableModel };
