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
import { join } from 'lodash';


/**
 * TableModel provides generic CRUD operations for a PostgreSQL table using pg-promise
 * and a structured JSON schema. It supports pagination, filtering, and conditional querying.
 */

/**
 * Creates an instance of TableModel.
 *
 * @param {Object} db - Database instance created by pg-promise.
 * @param {Object} pgp - pg-promise root instance for helpers and formatting.
 * @param {Object} schema - JSON schema definition for the table.
 * @param {Object} [logger] - Optional logger with debug and error methods.
 */
class TableModel extends QueryModel {

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
      data: { query, values: [id] }
    });
    try {
      return await this.db.result(query, [id], r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async insert(dto) {
    if (!isPlainObject(dto)) {
      return Promise.reject(new SchemaDefinitionError('DTO must be a non-empty object'));
    }
    const safeDto = this.sanitizeDto(dto);
    if (Object.keys(safeDto).length === 0) {
      return Promise.reject(
        new SchemaDefinitionError('DTO must contain at least one valid column')
      );
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
      data: { query, values: [] }
    });
    try {
      return await this.db.one(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async reload(id) {
    return this.findById(id);
  }

  async update(id, dto) {
    if (!isValidId(id)) {
      return Promise.reject(new SchemaDefinitionError('Invalid ID format'));
    }
    if (
      typeof dto !== 'object' ||
      Array.isArray(dto) ||
      Object.keys(dto).length === 0
    ) {
      return Promise.reject(new SchemaDefinitionError('DTO must be a non-empty object'));
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
      data: { query, values: [id] }
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

  async findAfterCursor(
    cursor = {},
    limit = 50,
    orderBy = ['id'],
    options = {}
  ) {
    const {
      descending = false,
      columnWhitelist = null,
      filters = {},
    } = options;
    const direction = descending ? 'DESC' : 'ASC';
    const table = `${this.schemaName}.${this.tableName}`;
    const selectCols = columnWhitelist?.length
      ? columnWhitelist.map(col => this.escapeName(col)).join(', ')
      : '*';
    const escapedOrderCols = orderBy
      .map(col => this.escapeName(col))
      .join(', ');
    const queryParts = [`SELECT ${selectCols} FROM ${table}`];
    const whereClauses = [];
    const values = [];
    if (Object.keys(cursor).length > 0) {
      const cursorValues = orderBy.map(col => {
        if (!(col in cursor)) throw new Error(`Missing cursor for ${col}`);
        return cursor[col];
      });
      const placeholders = cursorValues.map((_, i) => `$${i + 1}`).join(', ');
      whereClauses.push(
        `(${escapedOrderCols}) ${descending ? '<' : '>'} (${placeholders})`
      );
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
      data: { query, values }
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
  async deleteWhere(where) {
    const { clause, values } = this.buildWhereClause(where);
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query, values }
    });
    try {
      return await this.db.result(query, values, r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async touch(id, updatedBy = 'system') {
    return this.update(id, { updated_by: updatedBy });
  }

  async updateWhere(where, updates) {
    const isNonEmpty = val =>
      Array.isArray(val)
        ? val.length > 0
        : isPlainObject(val)
        ? Object.keys(val).length > 0
        : false;

    if (!isNonEmpty(where)) {
      throw new SchemaDefinitionError(
        'WHERE clause must be a non-empty object or non-empty array'
      );
    }

    if (!isNonEmpty(updates)) {
      throw new SchemaDefinitionError('UPDATE payload must be a non-empty object');
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
      data: { query, values }
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
  async bulkInsert(records) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: `Inserting ${records.length} records`
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
      data: { query, values: [] }
    });
    try {
      return await this.db.tx(t => t.result(query, [], r => r.rowCount));
    } catch (err) {
      this.handleDbError(err);
    }
  }

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
      message: `Updating ${records.length} records`
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
      data: { query, values: [] }
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
   * Exports table data to an Excel spreadsheet.
   * @param {string} filePath - Path to the .xlsx file to write.
   * @param {Object} [where={}] - Optional filter for records.
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
      message: `Exported ${rows.length} records to ${filePath}`
    });

    return { exported: rows.length, filePath };
  }

  /**
   * Imports data from an Excel spreadsheet and inserts it into the table.
   * You can specify the index of the sheet to import (default is 0).
   * @param {string} filePath - Path to the .xlsx file to import.
   * @param {number} [sheetIndex=0] - Index of the sheet to import.
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
      message: `Importing ${rows.length} records from spreadsheet`
    });

    const inserted = await this.bulkInsert(rows);
    return { inserted };
  }

  // ---------------------------------------------------------------------------
  // 🟣 Utilities
  // ---------------------------------------------------------------------------

  sanitizeDto(dto, { includeImmutable = true } = {}) {
    const validColumns = this._schema.columns
      .filter(c => includeImmutable || !c.immutable)
      .map(c => c.name);
    const sanitized = {};
    for (const key in dto) {
      if (validColumns.includes(key)) {
        sanitized[key] = dto[key];
      }
    }
    return sanitized;
  }

  setSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
  }

  async truncate() {
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Truncating table'
    });
    const query = `TRUNCATE TABLE ${this.schemaName}.${this.tableName} RESTART IDENTITY CASCADE`;
    logMessage({
      logger: this.logger,
      level: 'debug',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Executing SQL',
      data: { query }
    });
    try {
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  withSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
    return this;
  }

  async createTable() {
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Creating table from schema'
    });
    try {
      const query = createTableSQL(this._schema);
      logMessage({
        logger: this.logger,
        level: 'debug',
        schema: this._schema.dbSchema,
        table: this._schema.table,
        message: 'Executing SQL',
        data: { query }
      });
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }
}

export default TableModel;
export { TableModel };