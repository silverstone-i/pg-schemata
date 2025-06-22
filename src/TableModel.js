'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import pgPromise from 'pg-promise';
const TableName = pgPromise({}).helpers.TableName;
import QueryModel from './QueryModel.js';
import SchemaDefinitionError from './SchemaDefinitionError.js';
import { createTableSQL } from './utils/schemaBuilder.js';
import ExcelJS from 'exceljs';
import { isValidId, isPlainObject } from './utils/validation.js';
import { logMessage } from './utils/pg-util.js';
import { generateZodFromTableSchema } from './utils/generateZodValidator.js';

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
    super(db, pgp, schema, logger);

    // Auto-generate Zod validators if not provided
    if (!this._schema.validators) {
      this._schema.validators = generateZodFromTableSchema(this._schema);
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
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE id = $1`;
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values: [id] },
    });
    try {
      return await this.db.result(query, [id], r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
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
    if (!safeDto.created_by) safeDto.created_by = 'system';
    let query;
    try {
      query = this.pgp.helpers.insert(safeDto, this.cs.insert) + ' RETURNING *';
    } catch (err) {
      const error = new Error('Failed to construct insert query');
      error.cause = err;
      return Promise.reject(error);
    }
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query },
    });
    try {
      return await this.db.one(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Reloads a single record by ID using findById.
   * @param {string|number} id - Primary key value.
   * @returns {Promise<Object|null>} The found record or null.
   */
  async reload(id) {
    return this.findById(id);
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
    if (!safeDto.updated_by) safeDto.updated_by = 'system';
    const condition = this.pgp.as.format('WHERE id = $1', [id]);
    const query =
      this.pgp.helpers.update(safeDto, this.cs.update, {
        schema: this.schema.dbSchema,
        table: this.schema.table,
      }) +
      ' ' +
      condition +
      ' RETURNING *';
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values: [id] },
    });
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

  // ---------------------------------------------------------------------------
  // 🟠 Query & Filtering
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a paginated set of rows after a cursor position.
   * @param {Object} cursor - Cursor values keyed by orderBy columns.
   * @param {number} limit - Max number of rows to return.
   * @param {Array<string>} orderBy - Columns used for pagination ordering.
   * @param {Object} options - Extra filters and options.
   * @returns {Promise<{rows: Object[], nextCursor: Object|null}>} Paginated result.
   */
  async findAfterCursor(cursor = {}, limit = 50, orderBy = ['id'], options = {}) {
    const { descending = false, columnWhitelist = null, filters = {} } = options;
    const direction = descending ? 'DESC' : 'ASC';
    const table = `${this.schemaName}.${this.tableName}`;
    const selectCols = columnWhitelist?.length ? columnWhitelist.map(col => this.escapeName(col)).join(', ') : '*';
    const escapedOrderCols = orderBy.map(col => this.escapeName(col)).join(', ');
    const queryParts = [`SELECT ${selectCols} FROM ${table}`];
    const whereClauses = [];
    const values = [];
    if (Object.keys(cursor).length > 0) {
      const cursorValues = orderBy.map(col => {
        if (!(col in cursor)) throw new Error(`Missing cursor for ${col}`);
        return cursor[col];
      });
      const placeholders = cursorValues.map((_, i) => `$${i + 1}`).join(', ');
      whereClauses.push(`(${escapedOrderCols}) ${descending ? '<' : '>'} (${placeholders})`);
      values.push(...cursorValues);
    }
    if (Object.keys(filters).length) {
      if (filters.and || filters.or) {
        const top = filters.and
          ? this.buildCondition(filters.and, 'AND', values)
          : this.buildCondition(filters.or, 'OR', values);
        whereClauses.push(top);
      } else {
        whereClauses.push(this.buildCondition([filters], 'AND', values));
      }
    }
    if (whereClauses.length) {
      queryParts.push('WHERE', whereClauses.join(' AND '));
    }
    queryParts.push(`ORDER BY ${escapedOrderCols} ${direction}`);
    queryParts.push(`LIMIT $${values.length + 1}`);
    values.push(limit);
    const query = queryParts.join(' ');
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values },
    });
    const rows = await this.db.any(query, values);
    const nextCursor =
      rows.length > 0
        ? orderBy.reduce((acc, col) => {
            acc[col] = rows[rows.length - 1][col];
            return acc;
          }, {})
        : null;
    return { rows, nextCursor };
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
    const { clause, values } = this.buildWhereClause(where);
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values },
    });
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
  async touch(id, updatedBy = 'system') {
    return this.update(id, { updated_by: updatedBy });
  }

  /**
   * Updates rows matching a WHERE clause.
   * @param {Object|Array} where - Conditions.
   * @param {Object} updates - Fields to update.
   * @returns {Promise<number>} Number of rows updated.
   * @throws {SchemaDefinitionError} If input is invalid.
   */
  async updateWhere(where, updates) {
    const isNonEmpty = val =>
      Array.isArray(val) ? val.length > 0 : isPlainObject(val) ? Object.keys(val).length > 0 : false;

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
      console.log('Update validation error:', err);
      
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

    if (!safeUpdates.updated_by) safeUpdates.updated_by = 'system';
    const updateCs = new this.pgp.helpers.ColumnSet(Object.keys(safeUpdates), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const setClause = this.pgp.helpers.update(safeUpdates, updateCs);

    const { clause, values } = this.buildWhereClause(where);

    const query = `${setClause} WHERE ${clause}`;
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values },
    });

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
   * Inserts many rows in a single batch operation.
   * @param {Object[]} records - Rows to insert.
   * @returns {Promise<number>} Number of rows inserted.
   * @throws {SchemaDefinitionError} If records are invalid.
   */
  async bulkInsert(records) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: `Inserting ${records.length} records`,
    });
    const safeRecords = records.map(dto => {
      const sanitized = this.sanitizeDto(dto);
      if (!sanitized.created_by) sanitized.created_by = 'system';
      return sanitized;
    });

    const cs = new this.pgp.helpers.ColumnSet(Object.keys(safeRecords[0]), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });
    const query = this.pgp.helpers.insert(safeRecords, cs);

    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values: [] },
    });
    try {
      return await this.db.tx(t => t.result(query, [], r => r.rowCount));
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Updates multiple rows using their primary keys.
   * @param {Object[]} records - Each must include an ID field.
   * @returns {Promise<number[]>} Array of row counts updated per query.
   * @throws {SchemaDefinitionError} If input or IDs are invalid.
   */
  async bulkUpdate(records) {
    const pk = this._schema.constraints?.primaryKey;
    if (!pk) {
      throw new SchemaDefinitionError('Primary key must be defined in the schema');
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: `Updating ${records.length} records`,
    });

    const first = records[0];
    if (!first.id) {
      throw new SchemaDefinitionError('Each record must include an "id" field');
    }

    const queries = records.map(dto => {
      const id = dto.id;
      if (!isValidId(id)) {
        throw new SchemaDefinitionError(`Invalid ID in record: ${JSON.stringify(dto)}`);
      }
      const safeDto = this.sanitizeDto(dto, { includeImmutable: false });
      if (!safeDto.updated_by) safeDto.updated_by = 'system';
      delete safeDto.id;
      const condition = this.pgp.as.format('WHERE id = $1', [id]);
      const updateCs = new this.pgp.helpers.ColumnSet(Object.keys(safeDto), {
        table: { table: this._schema.table, schema: this._schema.dbSchema },
      });
      return this.pgp.helpers.update(safeDto, updateCs) + ' ' + condition;
    });

    const query = queries.join('; ');
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values: [] },
    });
    try {
      return await this.db.tx(t => {
        return t.batch(queries.map(q => t.result(q, [], r => r.rowCount)));
      });
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Exports table data to an Excel file based on filter criteria.
   * @param {string} filePath - Destination .xlsx path.
   * @param {Array} [where=[]] - Optional conditions.
   * @param {string} [joinType='AND'] - Join type between conditions.
   * @param {Object} [options={}] - Additional query options.
   * @returns {Promise<{exported: number, filePath: string}>}
   */
  async exportToSpreadsheet(filePath, where = [], joinType = 'AND', options = {}) {
    const { rows } = await this.findWhere(where, joinType, options);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(this.tableName);

    if (!rows.length) {
      worksheet.addRow(['No data found']);
    } else {
      worksheet.columns = Object.keys(rows[0]).map(key => ({ header: key, key }));
      rows.forEach(row => {
        worksheet.addRow(row);
      });
    }

    await workbook.xlsx.writeFile(filePath);

    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: `Exported ${rows.length} records to ${filePath}`,
    });

    return { exported: rows.length, filePath };
  }

  /**
   * Loads data from an Excel file and inserts it into the table.
   * @param {string} filePath - Source .xlsx file path.
   * @param {number} [sheetIndex=0] - Sheet index to load.
   * @returns {Promise<{inserted: number}>}
   * @throws {SchemaDefinitionError} If file format is invalid.
   */
  async importFromSpreadsheet(filePath, sheetIndex = 0) {
    if (typeof filePath !== 'string') {
      throw new SchemaDefinitionError('File path must be a valid string');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[sheetIndex];

    if (!worksheet) {
      throw new SchemaDefinitionError(
        `Sheet index ${sheetIndex} is out of bounds. Found ${workbook.worksheets.length} sheets.`
      );
    }

    const rows = [];
    let headers = [];
    worksheet.eachRow((row, rowNumber) => {
      const values = row.values;
      if (rowNumber === 1) {
        headers = values.slice(1); // skip the empty 0 index
      } else {
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = values[i + 1];
        });
        rows.push(obj);
      }
    });

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

    const inserted = await this.bulkInsert(rows);
    return { inserted };
  }

  // ---------------------------------------------------------------------------
  // 🟣 Utilities
  // ---------------------------------------------------------------------------

  /**
   * Returns a sanitized copy of the input, filtering out invalid or immutable columns.
   * @param {Object} dto - Input object.
   * @param {Object} [options]
   * @param {boolean} [options.includeImmutable=true]
   * @returns {Object} Sanitized DTO.
   */
  sanitizeDto(dto, { includeImmutable = true } = {}) {
    const validColumns = this._schema.columns.filter(c => includeImmutable || !c.immutable).map(c => c.name);
    const sanitized = {};
    for (const key in dto) {
      if (validColumns.includes(key)) {
        sanitized[key] = dto[key];
      }
    }
    return sanitized;
  }

  /**
   * Sets a new schema name in the internal schema.
   * @param {string} dbSchema - New schema name.
   */
  setSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
  }

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
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query },
    });
    try {
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Sets a new schema name and returns the current model instance.
   * @param {string} dbSchema - New schema name.
   * @returns {TableModel}
   */
  withSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
    return this;
  }

  /**
   * Creates the table using the current schema definition.
   * @returns {Promise<void>}
   */
  async createTable() {
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Creating table from schema',
    });
    try {
      const query = createTableSQL(this._schema);
      logMessage({
        logger: this.logger,
        level: 'debug',
        schema: this._schema.dbSchema,
        table: this._schema.table,
        message: 'Executing SQL',
        data: { query },
      });
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }
}

export default TableModel;
export { TableModel };
