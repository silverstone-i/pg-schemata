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
 * BaseModel provides generic CRUD operations for a PostgreSQL table
 * using pg-promise and a JSON schema definition.
 */

import { createColumnSet, addAuditFields } from './utils/schemaBuilder.js';
import { isValidId, isPlainObject } from './utils/validation.js';

// Initializes the BaseModel with db connection, pg-promise instance,
// schema definition, and optional logger. Validates required schema fields.
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

  // Escapes a database identifier (e.g. column or table name) using pg-promise formatting.
  escapeName(name) {
    return this.pgp.as.name(name);
  }

  // Returns the escaped schema name.
  get schemaName() {
    return this.escapeName(this._schema.dbSchema);
  }

  // Returns the schema object.
  get schema() {
    return this._schema;
  }

  // Returns the escaped table name.
  get tableName() {
    return this.escapeName(this._schema.table);
  }

  // Filters the input DTO to include only valid column names defined in the schema.
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

  // Logs the query if a logger is provided and has a debug method.
  logQuery(query) {
    if (this.logger?.debug) {
      this.logger.debug(`Running query: ${query}`);
    }
  }

  async insert(dto) {
    // Validate that the DTO is a non-empty object
    if (!isPlainObject(dto)) {
      return Promise.reject(new Error('DTO must be a non-empty object'));
    }

    // Sanitize the DTO to include only valid columns
    const safeDto = this.sanitizeDto(dto);

    // Check that the sanitized DTO has at least one valid column
    if (Object.keys(safeDto).length === 0) {
      return Promise.reject(
        new Error('DTO must contain at least one valid column')
      );
    }

    // Construct the insert query
    const query =
      this.pgp.helpers.insert(safeDto, this.cs.insert) + ' RETURNING *';

    // Log the constructed query
    this.logQuery(query);

    // Execute the query and handle any potential errors
    try {
      return await this.db.one(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // Fetches all records with pagination support using limit and offset.
  async findAll({ limit = 50, offset = 0 } = {}) {
    const query = `SELECT * FROM ${this.schemaName}.${this.tableName} ORDER BY id LIMIT $1 OFFSET $2`;
    this.logQuery(query);

    try {
      return await this.db.any(query, [limit, offset]);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // Retrieves a single row by ID. Returns null if not found.
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

  // Alias for findById, used to refresh a record by its ID.
  async reload(id) {
    return this.findById(id);
  }
  
  async findBy(conditions = [], joinType = 'AND', {
    columnWhitelist = null,
    filters = {}
  } = {}) {
    // Validate that conditions is a non-empty array
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return Promise.reject(new Error('Conditions must be a non-empty array'));
    }

    // Prepare the table name and selected columns
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

    // Handle additional filters
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

    // Add WHERE clause if there are conditions
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

    // Determine the order direction based on descending flag
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

    // Cursor condition for pagination
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

    // Handle additional filters
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

    // Add WHERE clause if there are conditions
    if (whereClauses.length) {
      queryParts.push('WHERE', whereClauses.join(' AND '));
    }

    // Add ordering and limit to the query
    queryParts.push(`ORDER BY ${escapedOrderCols} ${direction}`);
    queryParts.push(`LIMIT $${values.length + 1}`);
    values.push(limit);

    const query = queryParts.join(' ');
    this.logQuery?.(query);

    const rows = await this.db.any(query, values);

    // Determine the next cursor based on the last row
    const nextCursor =
      rows.length > 0
        ? orderBy.reduce((acc, col) => {
            acc[col] = rows[rows.length - 1][col];
            return acc;
          }, {})
        : null;

    return { rows, nextCursor };
  }

  // Executes findBy with AND conditions and returns only the first result.
  async findOneBy(conditions, options = {}) {
    try {
      const results = await this.findBy(conditions, 'AND', options);
      return results[0] || null;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // Checks if a record exists matching the given condition object.
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
    // Validate that the ID is in a valid format
    if (!isValidId(id)) {
      return Promise.reject(new Error('Invalid ID format'));
    }

    // Validate that the DTO is a non-empty object
    if (
      typeof dto !== 'object' ||
      Array.isArray(dto) ||
      Object.keys(dto).length === 0
    ) {
      return Promise.reject(new Error('DTO must be a non-empty object'));
    }

    // Sanitize the DTO to include only valid columns
    const safeDto = this.sanitizeDto(dto);

    // Prepare the condition for the SQL UPDATE
    const condition = this.pgp.as.format('WHERE id = $1', [id]);

    // Construct the update query using pg-promise helpers
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

  // Deletes a row by ID. Returns the number of rows affected.
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

  // Returns the total number of rows in the table.
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

  // Removes all rows and resets ID sequence using TRUNCATE CASCADE.
  async truncate() {
    const query = `TRUNCATE TABLE ${this.schemaName}.${this.tableName} RESTART IDENTITY CASCADE`;
    this.logQuery(query);

    try {
      return await this.db.none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // Sets the schema name for this instance of BaseModel.
  setSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
  }

  // Sets the schema name and returns the instance for chaining.
  withSchema(dbSchema) {
    this._schema.dbSchema = dbSchema;
    return this;
  }

  #buildCondition(group, joiner = 'AND', values = []) {
    const parts = [];
    for (const item of group) {
      if (item.and) {
        // Recursively handle AND conditions
        parts.push(`(${this.#buildCondition(item.and, 'AND', values)})`);
      } else if (item.or) {
        // Recursively handle OR conditions
        parts.push(`(${this.#buildCondition(item.or, 'OR', values)})`);
      } else {
        for (const [key, val] of Object.entries(item)) {
          const col = this.escapeName(key);
          if (val && typeof val === 'object') {
            if ('like' in val) {
              // Handle LIKE filter
              values.push(val.like);
              parts.push(`${col} LIKE $${values.length}`);
            } else if ('ilike' in val) {
              // Handle ILIKE filter
              values.push(val.ilike);
              parts.push(`${col} ILIKE $${values.length}`);
            } else {
              // Handle range filters
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
            // Handle equality condition
            values.push(val);
            parts.push(`${col} = $${values.length}`);
          }
        }
      }
    }
    return parts.join(` ${joiner} `);
  }

  // Logs the database error (if logger exists) and rethrows the error.
  handleDbError(err) {
    if (this.logger?.error) {
      this.logger.error('Database error:', err);
    }
    throw err; // re-throw so it propagates
  }
}

export default BaseModel;
