'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import { createColumnSet, addAuditFields } from './utils/schemaBuilder.js';
import { isValidId, isPlainObject } from './utils/validation.js';

class BaseModel {
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
    this._schema = JSON.parse(JSON.stringify(addAuditFields(schema)));
    this.cs = createColumnSet(this.schema, this.pgp);
  }

  escapeName(name) {
    return this.pgp.as.name(name);
  }

  get schemaName() {
    return this.escapeName(this._schema.dbSchema);
  }

  get schema() {
    return this._schema;
  }

  get tableName() {
    return this.escapeName(this._schema.table);
  }

  sanitizeDto(dto) {
    const validColumns = this._schema.columns.map(c => c.name);
    const sanitized = {};
    for (const key in dto) {
      if (validColumns.includes(key)) {
        sanitized[key] = dto[key];
      }
    }
    return sanitized;
  }

  logQuery(query) {
    if (this.logger?.debug) {
      this.logger.debug(`Running query: ${query}`);
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

    const query =
      this.pgp.helpers.insert(safeDto, this.cs.insert) + ' RETURNING *';

    this.logQuery(query);

    try {
      return await this.db.one(query);
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

  async reload(id) {
    return this.findById(id);
  }
  
  async findBy(conditions = [], joinType = 'AND', {
    columnWhitelist = null,
    filters = {}
  } = {}) {
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

    // Base conditions
    const baseConditions = conditions.map((condition, idx) => {
      const key = Object.keys(condition)[0];
      const val = Object.values(condition)[0];
      values.push(val);
      return `${this.escapeName(key)} = $${values.length}`;
    });

    if (baseConditions.length) {
      whereClauses.push(`(${baseConditions.join(` ${joinType.toUpperCase()} `)})`);
    }

    // Recursive filter parser (same logic as in findAfterCursor)
    const buildCondition = (group, joiner = 'AND') => {
      const parts = [];
      for (const item of group) {
        if (item.and) {
          parts.push(`(${buildCondition(item.and, 'AND')})`);
        } else if (item.or) {
          parts.push(`(${buildCondition(item.or, 'OR')})`);
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
    };

    if (Object.keys(filters).length) {
      if (filters.and || filters.or) {
        const top = filters.and
          ? buildCondition(filters.and, 'AND')
          : buildCondition(filters.or, 'OR');
        whereClauses.push(top);
      } else {
        whereClauses.push(buildCondition([filters]));
      }
    }

    if (whereClauses.length) {
      queryParts.push('WHERE', whereClauses.join(' AND '));
    }

    const query = queryParts.join(' ');
    this.logQuery(query);

    try {
      return await this.db.any(query, values);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Paginated fetch with advanced filtering (AND, OR, LIKE, ILIKE, ranges).
   *
   * @param {Object} cursor - Composite cursor (e.g. { created_at, id }).
   * @param {number} limit - Max results per page.
   * @param {Array<string>} orderBy - Columns to order by.
   * @param {Object} options
   * @param {boolean} options.descending
   * @param {Array<string>} options.columnWhitelist
   * @param {Object} options.filters - Nested filters: { and: [...], or: [...] }
   */
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

    // Cursor condition
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

    // Recursive filter parser
    const buildCondition = (group, joiner = 'AND') => {
      const parts = [];
      for (const item of group) {
        if (item.and) {
          parts.push(`(${buildCondition(item.and, 'AND')})`);
        } else if (item.or) {
          parts.push(`(${buildCondition(item.or, 'OR')})`);
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
    };

    if (Object.keys(filters).length) {
      if (filters.and || filters.or) {
        const top = filters.and
          ? buildCondition(filters.and, 'AND')
          : buildCondition(filters.or, 'OR');
        whereClauses.push(top);
      } else {
        whereClauses.push(buildCondition([filters]));
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
      const results = await this.findBy(conditions, 'AND', options);
      return results[0] || null;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async exists(conditions) {
    if (!isPlainObject(conditions) || Object.keys(conditions).length === 0) {
      return Promise.reject(Error('Conditions must be a non-empty object'));
    }

    const keys = Object.keys(conditions).map(key => this.escapeName(key));
    const values = Object.values(conditions);
    const whereClause = keys
      .map((key, idx) => `${key} = $${idx + 1}`)
      .join(' AND ');

    const query = `SELECT EXISTS (SELECT 1 FROM ${this.schemaName}.${this.tableName} WHERE ${whereClause}) AS "exists"`;
    this.logQuery(query);

    try {
      const result = await this.db.one(query, values);
      return result.exists;
    } catch (err) {
      this.handleDbError(err);
    }
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

    const safeDto = this.sanitizeDto(dto);

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
      return await this.db.one(query);
    } catch (err) {
      this.handleDbError(err);
    }
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

  async count() {
    const query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName}`;
    this.logQuery(query);

    try {
      const result = await this.db.one(query);
      return parseInt(result.count, 10);
    } catch (err) {
      this.handleDbError(err);
    }
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

  setSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
  }

  withSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
    return this;
  }

  handleDbError(err) {
    if (this.logger?.error) {
      this.logger.error('Database error:', err);
    }
    throw err; // re-throw so it propagates
  }
}

export default BaseModel;
