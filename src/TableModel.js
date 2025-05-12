'use strict';

import pgPromise from 'pg-promise';
const TableName = pgPromise({}).helpers.TableName;

import QueryModel from './QueryModel.js';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

/**
 * TableModel provides generic CRUD operations for a PostgreSQL table using pg-promise
 * and a structured JSON schema. It supports pagination, filtering, and conditional querying.
 */

import {
  createTableSQL,
} from './utils/schemaBuilder.js';
import { isValidId, isPlainObject } from './utils/validation.js';

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
    try {
      return await this.db.result(query, [id], r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
  }


  async insert(dto) {
    if (!isPlainObject(dto)) {
      return Promise.reject(new Error('DTO must be a non-empty object'));
    }
    const safeDto = this.sanitizeDto(dto);
    if (Object.keys(safeDto).length === 0) {
      return Promise.reject(
        new Error('DTO must contain at least one valid column')
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
    this.logQuery(query);
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
      return Promise.reject(new Error('Invalid ID format'));
    }
    if (
      typeof dto !== 'object' ||
      Array.isArray(dto) ||
      Object.keys(dto).length === 0
    ) {
      return Promise.reject(new Error('DTO must be a non-empty object'));
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
    this.logQuery(query);
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
    this.logQuery?.(query);
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
  // 🟡 Counting
  // ---------------------------------------------------------------------------

  async countAll() {
    const query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName}`;
    this.logQuery(query);
    try {
      const result = await this.db.one(query);
      return parseInt(result.count, 10);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🟤 Conditional Mutations
  // ---------------------------------------------------------------------------
  async deleteWhere(where) {
    const { clause, values } = this.buildWhereClause(where);
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    this.logQuery(query);
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
    if (!isPlainObject(where) || Object.keys(where).length === 0) {
      throw new Error('WHERE clause must be a non-empty object');
    }
    if (!isPlainObject(updates) || Object.keys(updates).length === 0) {
      throw new Error('UPDATE payload must be a non-empty object');
    }
    const safeUpdates = this.sanitizeDto(updates, { includeImmutable: false });
    if (!safeUpdates.updated_by) safeUpdates.updated_by = 'system';
    const updateCs = new this.pgp.helpers.ColumnSet(Object.keys(safeUpdates), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });
    const setClause = this.pgp.helpers.update(safeUpdates, updateCs);
    const { clause, values } = this.buildWhereClause(where);
    const query = `${setClause} WHERE ${clause}`;
    this.logQuery(query);
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
      throw new Error('Records must be a non-empty array');
    }
    const safeRecords = records.map(dto => {
      const sanitized = this.sanitizeDto(dto);
      if (!sanitized.created_by) sanitized.created_by = 'system';
      return sanitized;
    });
    const cs = new this.pgp.helpers.ColumnSet(Object.keys(safeRecords[0]), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });
    const query = this.pgp.helpers.insert(safeRecords, cs);
    this.logQuery(query);
    try {
      await this.db.tx(t => t.none(query));
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async bulkUpdate(records) {
    const pk = this._schema.constraints?.primaryKey;
    if (!pk) {
      throw new Error('Primary key must be defined in the schema');
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records must be a non-empty array');
    }

    const first = records[0];
    if (!first.id) {
      throw new Error('Each record must include an "id" field');
    }

    const queries = records.map(dto => {
      const id = dto.id;
      if (!isValidId(id)) {
        throw new Error(`Invalid ID in record: ${JSON.stringify(dto)}`);
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
    this.logQuery(query);
    try {
      return await this.db.tx(t => {
        return t.batch(queries.map(q => t.result(q, [], r => r.rowCount)));
      });
    } catch (err) {
      this.handleDbError(err);
    }
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
    const query = `TRUNCATE TABLE ${this.schemaName}.${this.tableName} RESTART IDENTITY CASCADE`;
    this.logQuery(query);
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
    try {
      const query = createTableSQL(this._schema);
      this.logQuery(query);
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // ⚫ Internal Helpers (Private)
  // ---------------------------------------------------------------------------

  handleDbError(err) {
    if (this.logger?.error) {
      this.logger.error('Database error:', err);
    }
    throw err;
  }
}

export default TableModel;
export { TableModel };
