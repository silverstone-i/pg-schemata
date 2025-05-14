'use strict';

/*
 * Copyright © 2024-present, Ian Silverstone
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

import cloneDeep from 'lodash/cloneDeep.js';
import { createColumnSet, addAuditFields } from './utils/schemaBuilder.js';
import { isValidId, isPlainObject } from './utils/validation.js';

class QueryModel {
  constructor(db, pgp, schema, logger = null) {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be an object');
    }
    if (!db || !pgp || !schema.table || !schema.columns || !schema.constraints.primaryKey) {
      throw new Error('Missing required parameters: db, pgp, schema, table, or primary key');
    }

    this.db = db;
    this.pgp = pgp;
    this.logger = logger;
    this._schema = cloneDeep(schema.hasAuditFields ? addAuditFields(schema) : schema);
    this.cs = createColumnSet(this.schema, this.pgp);
  }

  async findAll({ limit = 50, offset = 0 } = {}) {
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} ORDER BY id LIMIT $1 OFFSET $2`;
    this.logQuery(query);
    return this.db.any(query, [limit, offset]);
  }

  async findById(id) {
    if (!isValidId(id)) throw new Error('Invalid ID format');
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} WHERE id = $1`;
    this.logQuery(query);
    return this.db.oneOrNone(query, [id]);
  }

  async findWhere(conditions = [], joinType = 'AND', { columnWhitelist = null, filters = {}, orderBy = null, limit = null, offset = null } = {}) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      throw new Error('Conditions must be a non-empty array');
    }
    
    const table = `${this.schemaName}.${this.tableName}`;
    const selectCols = columnWhitelist?.length
      ? columnWhitelist.map(col => this.escapeName(col)).join(', ')
      : '*';
    const queryParts = [`SELECT ${selectCols} FROM ${table}`];
    const values = [];
    const whereClauses = [];

    const { clause, values: builtValues } = this.buildWhereClause(conditions, true, [], joinType);
    values.push(...builtValues);
    whereClauses.push(`(${clause})`);

    if (Object.keys(filters).length) {
      whereClauses.push(this.buildCondition([filters], 'AND', values));
    }

    if (whereClauses.length) queryParts.push('WHERE', whereClauses.join(' AND '));
    if (orderBy) {
      const orderClause = Array.isArray(orderBy)
        ? orderBy.map(col => this.escapeName(col)).join(', ')
        : this.escapeName(orderBy);
      queryParts.push(`ORDER BY ${orderClause}`);
    }
    if (limit) queryParts.push(`LIMIT ${parseInt(limit, 10)}`);
    if (offset) queryParts.push(`OFFSET ${parseInt(offset, 10)}`);

    const query = queryParts.join(' ');

    this.logQuery(query);
    return this.db.any(query, values);
  }

    async exists(conditions) {
    if (!isPlainObject(conditions) || Object.keys(conditions).length === 0) {
      return Promise.reject(Error('Conditions must be a non-empty object'));
    }
    const { clause, values } = this.buildWhereClause(conditions);
    const query = `SELECT EXISTS (SELECT 1 FROM ${this.schemaName}.${this.tableName} WHERE ${clause}) AS "exists"`;
    this.logQuery(query);
    try {
      const result = await this.db.one(query, values);
      return result.exists;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  async count(where) {
    const { clause, values } = this.buildWhereClause(where);
    const query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    this.logQuery(query);
    const result = await this.db.one(query, values);
    return parseInt(result.count, 10);
  }

  async findOneBy(conditions, options = {}) {
    const results = await this.findWhere(conditions, 'AND', options);
    return results[0] || null;
  }

  escapeName(name) {
    return this.pgp.as.name(name);
  }

  logQuery(query) {
    if (this.logger?.debug) this.logger.debug(`Running query: ${query}`);
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

  buildWhereClause(where = {}, requireNonEmpty = true, values = [], joinType = 'AND') {
    if (Array.isArray(where)) {
      if (requireNonEmpty && where.length === 0) {
        throw new Error('WHERE clause must be a non-empty array');
      }
      const clause = this.buildCondition(where, joinType, values);
      return { clause, values };
    }

    if (!isPlainObject(where) || (requireNonEmpty && Object.keys(where).length === 0)) {
      throw new Error('WHERE clause must be a non-empty object');
    }
    const keys = Object.keys(where).map(key => this.escapeName(key));
    const vals = Object.values(where);
    vals.forEach(val => values.push(val));
    const clause = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');
    return { clause, values };
  }

  buildCondition(group, joiner = 'AND', values = []) {
    const parts = [];
    for (const item of group) {
      if (item.and && Array.isArray(item.and) && item.and.length > 0) {
        parts.push(`(${this.buildCondition(item.and, 'AND', values)})`);
      } else if (item.or && Array.isArray(item.or) && item.or.length > 0) {
        parts.push(`(${this.buildCondition(item.or, 'OR', values)})`);
      } else {
        for (const [key, val] of Object.entries(item)) {
          const col = this.escapeName(key);
          if (val && typeof val === 'object') {
            const supportedKeys = ['like', 'ilike', 'from', 'to', 'in', '$in'];
            const keys = Object.keys(val);
            const unsupported = keys.filter(k => !supportedKeys.includes(k));
            if (unsupported.length > 0) {
              throw new Error(`Unsupported operator: ${unsupported[0]}`);
            }

            if ('like' in val) {
              values.push(val.like);
              parts.push(`${col} LIKE $${values.length}`);
            }
            if ('ilike' in val) {
              values.push(val.ilike);
              parts.push(`${col} ILIKE $${values.length}`);
            }
            if ('from' in val) {
              values.push(val.from);
              parts.push(`${col} >= $${values.length}`);
            }
            if ('to' in val) {
              values.push(val.to);
              parts.push(`${col} <= $${values.length}`);
            }
            if ('in' in val) {
              if (!Array.isArray(val.in) || val.in.length === 0) {
                throw new Error(`IN clause must be a non-empty array`);
              }
              const placeholders = val.in.map(v => {
                values.push(v);
                return `$${values.length}`;
              }).join(', ');
              parts.push(`${col} IN (${placeholders})`);
            }
            if ('$in' in val) {
              if (!Array.isArray(val['$in']) || val['$in'].length === 0) {
                throw new Error(`$IN clause must be a non-empty array`);
              }
              const placeholders = val['$in'].map(v => {
                values.push(v);
                return `$${values.length}`;
              }).join(', ');
              parts.push(`${col} IN (${placeholders})`);
            }
          } else {
            if (val === null) {
              parts.push(`${col} IS NULL`);
            } else {
              values.push(val);
              parts.push(`${col} = $${values.length}`);
            }
          }
        }
      }
    }
    return parts.join(` ${joiner} `);
  }
}

export default QueryModel;