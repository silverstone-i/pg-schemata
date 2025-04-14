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
    return this.escapeName(this.dbSchema);
  }

  get schema() {
    return this._schema;
  }

  get tableName() {
    return this.escapeName(this.table);
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

    const query = this.cs.insert(safeDto) + ' RETURNING *';
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

  async findAfterCursor(cursor, limit = 20) {
    if (!isValidId(cursor)) {
      return Promise.reject(new Error('Invalid cursor format'));
    }
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE id > $1 ORDER BY id ASC LIMIT $2`;
    this.logQuery(query);

    try {
      return await this.db.any(query, [cursor, limit]);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async findBy(conditions) {
    if (
      !isPlainObject(conditions) ||
      Object.keys(conditions).length === 0
    ) {
      return Promise.reject(new Error('Conditions must be a non-empty object'));
    }

    const keys = Object.keys(conditions).map(key => this.escapeName(key));
    const values = Object.values(conditions);
    const whereClause = keys
      .map((key, idx) => `${key} = $${idx + 1}`)
      .join(' AND ');

    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE ${whereClause}`;
    this.logQuery(query);

    try {
      return await this.db.any(query, values);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async findOneBy(conditions) {
    try {
      const results = await this.findBy(conditions);
      return results[0] || null;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async exists(conditions) {
    if (
      !isPlainObject(conditions) ||
      Object.keys(conditions).length === 0
    ) {
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
        table: this.table,
        schema: this.dbSchema,
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
    this.logQuery(query);

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
