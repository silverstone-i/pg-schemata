'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

/**
 * BaseModel provides generic CRUD operations for a PostgreSQL table using pg-promise
 * and a structured JSON schema. It supports pagination, filtering, and conditional querying.
 */

import cloneDeep from 'lodash/cloneDeep.js';
import {
  createColumnSet,
  addAuditFields,
  createTableSQL,
} from './utils/schemaBuilder.js';
import { isValidId, isPlainObject } from './utils/validation.js';

/**
 * Creates an instance of BaseModel.
 *
 * @param {Object} db - Database instance created by pg-promise.
 * @param {Object} pgp - pg-promise root instance for helpers and formatting.
 * @param {Object} schema - JSON schema definition for the table.
 * @param {Object} [logger] - Optional logger with debug and error methods.
 */
class BaseModel {
  // ---------------------------------------------------------------------------
  // 🟢 Core CRUD
  // ---------------------------------------------------------------------------
  constructor(db, pgp, schema, logger = null) {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be an object');
    }
    if (
      !db ||
      !pgp ||
      !schema ||
      !schema.table ||
      !schema.columns ||
      !schema.constraints.primaryKey
    ) {
      throw new Error(
        'Missing one or more required parameters: db, pgp, schema, table and/or primary key constraint'
      );
    }
    this.db = db;
    this.pgp = pgp;
    this.logger = logger;
    // deep clone to prevent mutation
    this._schema = cloneDeep(
      schema.hasAuditFields ? addAuditFields(schema) : schema
    );
    this.cs = createColumnSet(this.schema, this.pgp);
  }

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

  async findAll({ limit = 50, offset = 0 } = {}) {
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} ORDER BY id LIMIT $1 OFFSET $2`;
    this.logQuery(query);
    try {
      return await this.db.any(query, [limit, offset]);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async findById(id) {
    if (!isValidId(id)) {
      return Promise.reject(new Error('Invalid ID format'));
    }
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE id = $1`;
    this.logQuery(query);
    try {
      return await this.db.oneOrNone(query, [id]);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async insert(dto) {
    if (!isPlainObject(dto)) {
      return Promise.reject(new Error('DTO must be a non-empty object'));
    }
    const safeDto = this.sanitizeDto(dto);
    if (!safeDto.created_by) safeDto.created_by = 'system';
    if (Object.keys(safeDto).length === 0) {
      return Promise.reject(
        new Error('DTO must contain at least one valid column')
      );
    }
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
  async exists(conditions) {
    if (!isPlainObject(conditions) || Object.keys(conditions).length === 0) {
      return Promise.reject(Error('Conditions must be a non-empty object'));
    }
    const { clause, values } = this.#buildWhereClause(conditions);
    const query = `SELECT EXISTS (SELECT 1 FROM ${this.schemaName}.${this.tableName} WHERE ${clause}) AS "exists"`;
    this.logQuery(query);
    try {
      const result = await this.db.one(query, values);
      return result.exists;
    } catch (err) {
      this.handleDbError(err);
    }
  }

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
          ? this.#buildCondition(filters.and, 'AND', values)
          : this.#buildCondition(filters.or, 'OR', values);
        whereClauses.push(top);
      } else {
        whereClauses.push(this.#buildCondition([filters], 'AND', values));
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

  async findOneBy(conditions, options = {}) {
    try {
      const results = await this.findWhere(conditions, 'AND', options);
      return results[0] || null;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async findWhere(
    conditions = [],
    joinType = 'AND',
    { columnWhitelist = null, filters = {}, orderBy = null, limit = null, offset = null } = {}
  ) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return Promise.reject(new Error('Conditions must be a non-empty array'));
    }
    const table = `${this.schemaName}.${this.tableName}`;
    const selectCols = columnWhitelist?.length
      ? columnWhitelist.map(col => this.escapeName(col)).join(', ')
      : '*';
    const queryParts = [`SELECT ${selectCols} FROM ${table}`];
    const values = [];
    const whereClauses = [];
    const baseConditions = conditions.map((condition, idx) => {
      const key = Object.keys(condition)[0];
      const val = Object.values(condition)[0];
      values.push(val);
      return `${this.escapeName(key)} = $${values.length}`;
    });
    if (baseConditions.length) {
      whereClauses.push(
        `(${baseConditions.join(` ${joinType.toUpperCase()} `)})`
      );
    }
    if (Object.keys(filters).length) {
      if (filters.and || filters.or) {
        const top = filters.and
          ? this.#buildCondition(filters.and, 'AND', values)
          : this.#buildCondition(filters.or, 'OR', values);
        whereClauses.push(top);
      } else {
        whereClauses.push(this.#buildCondition([filters], 'AND', values));
      }
    }
    if (whereClauses.length) {
      queryParts.push('WHERE', whereClauses.join(' AND '));
    }
    if (orderBy) {
      const orderClause = Array.isArray(orderBy)
        ? orderBy.map(col => this.escapeName(col)).join(', ')
        : this.escapeName(orderBy);
      queryParts.push(`ORDER BY ${orderClause}`);
    }
    if (limit) {
      queryParts.push(`LIMIT ${parseInt(limit, 10)}`);
    }
    if (offset) {
      queryParts.push(`OFFSET ${parseInt(offset, 10)}`);
    }
    const query = queryParts.join(' ');
    this.logQuery(query);
    try {
      return await this.db.any(query, values);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🟡 Counting
  // ---------------------------------------------------------------------------
  async count(where) {
    const { clause, values } = this.#buildWhereClause(where);
    const query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    this.logQuery(query);
    try {
      const result = await this.db.one(query, values);
      return parseInt(result.count, 10);
    } catch (err) {
      this.handleDbError(err);
    }
  }

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
    const { clause, values } = this.#buildWhereClause(where);
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
    const { clause, values } = this.#buildWhereClause(where);
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
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records must be a non-empty array');
    }
    const pk = this.schema.constraints.primaryKey;
    if (!pk || typeof pk !== 'string') {
      throw new Error('Primary key must be defined in the schema');
    }
    const safeRecords = records.map(dto => {
      const sanitized = this.sanitizeDto(dto, { includeImmutable: false });
      if (!sanitized.updated_by) sanitized.updated_by = 'system';
      if (!sanitized[pk]) {
        throw new Error(`Missing primary key "${pk}" in one or more records`);
      }
      return sanitized;
    });
    const cs = new this.pgp.helpers.ColumnSet(Object.keys(safeRecords[0]), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });
    const query = this.pgp.helpers.update(safeRecords, cs) +
      ' WHERE v.' + this.escapeName(pk) + ' = t.' + this.escapeName(pk);
    const wrapped = `UPDATE ${this.schemaName}.${this.tableName} AS t SET ${query}`;
    this.logQuery(wrapped);
    try {
      await this.db.tx(t => t.none(wrapped));
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🟣 Utilities
  // ---------------------------------------------------------------------------
  escapeName(name) {
    return this.pgp.as.name(name);
  }

  get schema() {
    return this._schema;
  }

  get schemaName() {
    return this.escapeName(this._schema.dbSchema);
  }

  get tableName() {
    return this.escapeName(this._schema.table);
  }

  logQuery(query) {
    if (this.logger?.debug) {
      this.logger.debug(`Running query: ${query}`);
    }
  }

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
  /**
   * Builds a WHERE clause from an object of conditions.
   * @param {Object} where - Object of column-value pairs.
   * @param {boolean} [requireNonEmpty=true] - Whether to throw on empty object.
   * @returns {{ clause: string, values: any[] }} SQL clause and values.
   */
  #buildWhereClause(where = {}, requireNonEmpty = true) {
    if (!isPlainObject(where) || (requireNonEmpty && Object.keys(where).length === 0)) {
      throw new Error('WHERE clause must be a non-empty object');
    }
    const keys = Object.keys(where).map(key => this.escapeName(key));
    const values = Object.values(where);
    const clause = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');
    return { clause, values };
  }

  /**
   * Builds a WHERE clause recursively for the conditions.
   * @param {Array<Object>} group - Conditions to build the clause from.
   * @param {string} [joiner='AND'] - The joiner for the conditions.
   * @param {Array} values - Array to collect values for the query.
   * @returns {string} The constructed WHERE clause.
   */
  #buildCondition(group, joiner = 'AND', values = []) {
    const parts = [];
    for (const item of group) {
      if (item.and) {
        parts.push(`(${this.#buildCondition(item.and, 'AND', values)})`);
      } else if (item.or) {
        parts.push(`(${this.#buildCondition(item.or, 'OR', values)})`);
      } else {
        for (const [key, val] of Object.entries(item)) {
          const col = this.escapeName(key);
          if (val && typeof val === 'object') {
            if ('like' in val) {
              values.push(val.like);
              parts.push(`${col} LIKE $${values.length}`);
            } else if ('ilike' in val) {
              values.push(val.ilike);
              parts.push(`${col} ILIKE $${values.length}`);
            } else {
              if (val.from) {
                values.push(val.from);
                parts.push(`${col} >= $${values.length}`);
              }
              if (val.to) {
                values.push(val.to);
                parts.push(`${col} <= $${values.length}`);
              }
            }
          } else {
            values.push(val);
            parts.push(`${col} = $${values.length}`);
          }
        }
      }
    }
    return parts.join(` ${joiner} `);
  }

  handleDbError(err) {
    if (this.logger?.error) {
      this.logger.error('Database error:', err);
    }
    throw err;
  }
}

export default BaseModel;
export { BaseModel };
