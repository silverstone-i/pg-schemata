'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import { createColumnSet, addAuditFields } from '../utils/schemaBuilder.js';

class BaseModel {
  constructor(db, pgp, schema, logger = null) {
    if (typeof schema !== 'object') {
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
    this.dbSchema = JSON.parse(JSON.stringify(addAuditFields(schema)));
    this.cs = createColumnSet(this.schema, this.pgp);
  }

  escapeName(name) {
    return this.pgp.as.name(name);
  }

  get schemaName() {
    return this.escapeName(this.schema.dbSchema);
  }

  get tableName() {
    return this.escapeName(this.schema.table);
  }

  isValidId(id) {
    return (
      typeof id === 'number' || (typeof id === 'string' && id.trim().length > 0)
    );
  }

  validateUUID(id) {
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof id === 'string' && UUID_REGEX.test(id);
  }

  sanitizeDto(dto) {
    const validColumns = this.dbSchema.columns.map(c => c.name);
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
    if (typeof dto !== 'object' || Array.isArray(dto)) {
      throw new Error('DTO must be a non-array object');
    }
    const safeDto = this.sanitizeDto(dto);
    const query = this.cs.insert(safeDto) + ' RETURNING *';
    this.logQuery(query);
    return this.db.one(query);
  }

  async findAll({ limit = 50, offset = 0 } = {}) {
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} ORDER BY id LIMIT $1 OFFSET $2`;
    this.logQuery(query);
    return this.db.any(query, [limit, offset]);
  }

  async findById(id) {
    if (!this.isValidId(id)) {
      throw new Error('Invalid ID format');
    }
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE id = $1`;
    this.logQuery(query);
    return this.db.oneOrNone(query, [id]);
  }

  async reload(id) {
    return this.findById(id);
  }

  async findAfterCursor(cursor, limit = 20) {
    if (!this.isValidId(cursor)) {
      throw new Error('Invalid cursor format');
    }
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE id > $1 ORDER BY id ASC LIMIT $2`;
    this.logQuery(query);
    return this.db.any(query, [cursor, limit]);
  }

  async findBy(conditions) {
    if (typeof conditions !== 'object' || !Object.keys(conditions).length) {
      throw new Error('Conditions must be a non-empty object');
    }

    const keys = Object.keys(conditions).map(key => this.escapeName(key));
    const values = Object.values(conditions);
    const whereClause = keys
      .map((key, idx) => `${key} = $${idx + 1}`)
      .join(' AND ');

    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE ${whereClause}`;
    this.logQuery(query);
    return this.db.any(query, values);
  }

  async findOneBy(conditions) {
    const results = await this.findBy(conditions);
    return results[0] || null;
  }

  async exists(conditions) {
    if (typeof conditions !== 'object' || !Object.keys(conditions).length) {
      throw new Error('Conditions must be a non-empty object');
    }

    const keys = Object.keys(conditions).map(key => this.escapeName(key));
    const values = Object.values(conditions);
    const whereClause = keys
      .map((key, idx) => `${key} = $${idx + 1}`)
      .join(' AND ');

    const query = `SELECT EXISTS (SELECT 1 FROM ${this.schemaName}.${this.tableName} WHERE ${whereClause}) AS "exists"`;
    this.logQuery(query);
    const result = await this.db.one(query, values);
    return result.exists;
  }

  async update(id, dto) {
    if (!this.isValidId(id)) {
      throw new Error('Invalid ID format');
    }
    if (
      typeof dto !== 'object' ||
      Array.isArray(dto) ||
      Object.keys(dto).length === 0
    ) {
      throw new Error('DTO must be a non-empty object');
    }

    const safeDto = this.sanitizeDto(dto);

    const condition = this.pgp.as.format('WHERE id = $1', [id]);
    const query =
      this.pgp.helpers.update(safeDto, this.cs.update, {
        table: this.schema.table,
        schema: this.schema.dbSchema,
      }) +
      ' ' +
      condition +
      ' RETURNING *';

    this.logQuery(query);
    return this.db.one(query);
  }

  async delete(id) {
    if (!this.isValidId(id)) {
      throw new Error('Invalid ID format');
    }
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE id = $1`;
    this.logQuery(query);
    return this.db.result(query, [id], r => r.rowCount);
  }

  async count() {
    const query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName}`;
    this.logQuery(query);
    const result = await this.db.one(query);
    return parseInt(result.count, 10);
  }

  async truncate() {
    const query = `TRUNCATE TABLE ${this.schemaName}.${this.tableName} RESTART IDENTITY CASCADE`;
    this.logQuery(query);
    return this.db.none(query);
  }

  setSchema(dbSchema) {
    this.schema.dbSchema = dbSchema;
  }

  withSchema(dbSchema) {
    this.schema.dbSchema = dbSchema;
    return this;
  }
}

export default BaseModel;
