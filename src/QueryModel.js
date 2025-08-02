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
import DatabaseError from './DatabaseError.js';
import SchemaDefinitionError from './SchemaDefinitionError.js';
import { logMessage } from './utils/pg-util.js';
import _ from 'lodash';
const { cloneDeep } = _;

/**
 * QueryModel provides reusable read-only query logic for PostgreSQL tables.
 *
 * Designed for models that require flexible query-building capabilities, either as a standalone
 * read-only interface or to be extended for full CRUD functionality.
 *
 * It may be instantiated directly when only read-access is required.
 *
 * ✅ Features:
 * - Dynamic WHERE clause generation via `buildWhereClause` and `buildCondition`
 * - Query helpers: `findWhere`, `findAll`, `findOneBy`
 * - Aggregations and checks: `count`, `countAll`, `exists`
 * - Rich condition syntax with `$like`, `$from`, `$eq`, `$in`, `$and`, `$or`, etc.
 *
 * 📌 See [where-modifiers.md](where-modifiers.md) for full reference.
 */
class QueryModel {
  constructor(db, pgp, schema, logger = null) {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be an object');
    }
    if (!db || !pgp || !schema.table || !schema.columns) {
      throw new Error('Missing required parameters: db, pgp, schema, table, or primary key');
    }

    this.db = db;
    this.pgp = pgp;
    this.logger = logger;
    this._schema = cloneDeep(schema.hasAuditFields ? addAuditFields(schema) : schema);
    this.cs = createColumnSet(this.schema, this.pgp);
  }

  // ---------------------------------------------------------------------------
  // 🟢 Basic Queries
  // ---------------------------------------------------------------------------
  /**
   * Finds only soft-deleted records.
   * @param {Array<Object>} conditions - Optional extra conditions.
   * @param {string} joinType - Logical joiner ('AND' or 'OR').
   * @param {Object} options - Query options.
   * @returns {Promise<Object[]>} Soft-deleted rows.
   */
  async findSoftDeleted(conditions = [], joinType = 'AND', options = {}) {
    return this.findWhere([...conditions, { deactivated_at: { $ne: null } }], joinType, { ...options, includeDeactivated: true });
  }

  /**
   * Checks if a specific record is soft-deleted.
   * @param {number|string} id - The primary key value.
   * @returns {Promise<boolean>} True if the record is soft-deleted, false otherwise.
   */
  async isSoftDeleted(id) {
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.exists({ id, deactivated_at: { $ne: null } }, { includeDeactivated: true });
  }

  /**
   * Fetches all rows from the table with optional pagination.
   * @param {Object} options - Query options.
   * @param {number} [options.limit=50] - Maximum number of records to return.
   * @param {number} [options.offset=0] - Number of records to skip.
   * @returns {Promise<Object[]>} List of rows.
   */
  async findAll({ limit = 50, offset = 0 } = {}) {
    return this.findWhere([{ id: { $ne: null } }], 'AND', { limit, offset, orderBy: 'id' });
  }

  /**
   * Finds a single row by its ID.
   * @param {number|string} id - The primary key value.
   * @returns {Promise<Object|null>} Matching row or null if not found.
   * @throws {Error} If ID is invalid.
   */
  async findById(id) {
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.findOneBy([{ id }]);
  }

  /**
   * Finds a single row by its ID, including soft-deleted records.
   * @param {number|string} id - The primary key value.
   * @returns {Promise<Object|null>} Matching row or null if not found.
   * @throws {Error} If ID is invalid.
   */
  async findByIdIncludingDeactivated(id) {
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.findOneBy([{ id }], { includeDeactivated: true });
  }

  /**
   * Finds rows matching conditions and optional filters.
   * @param {Array<Object>} conditions - Array of condition objects.
   * @param {string} joinType - Logical operator ('AND' or 'OR').
   * @param {Object} options - Query options.
   * @param {Array<string>} [options.columnWhitelist] - Columns to return.
   * @param {Object} [options.filters] - Additional filter object.
   * @param {string|Array<string>} [options.orderBy] - Sort columns.
   * @param {number} [options.limit] - Limit results.
   * @param {number} [options.offset] - Offset results.
   * @param {boolean} [options.includeDeactivated=false] - Include soft-deleted records when true.
   * @returns {Promise<Object[]>} Matching rows.
   */
  async findWhere(
    conditions = [],
    joinType = 'AND',
    { columnWhitelist = null, filters = {}, orderBy = null, limit = null, offset = null, includeDeactivated = false } = {}
  ) {
    if (!Array.isArray(conditions)) {
      throw new Error('Conditions must be an array');
    }

    const table = `${this.schemaName}.${this.tableName}`;
    const selectCols = columnWhitelist?.length ? columnWhitelist.map(col => this.escapeName(col)).join(', ') : '*';
    const queryParts = [`SELECT ${selectCols} FROM ${table}`];
    const values = [];
    const whereClauses = [];

    if (conditions.length > 0) {
      const { clause, values: builtValues } = this.buildWhereClause(conditions, true, [], joinType, includeDeactivated === true);
      values.push(...builtValues);
      whereClauses.push(`(${clause})`);
    }

    if (Object.keys(filters).length) {
      whereClauses.push(this.buildCondition([filters], 'AND', values));
    }

    if (whereClauses.length) queryParts.push('WHERE', whereClauses.join(' AND '));
    if (orderBy) {
      const orderClause = Array.isArray(orderBy) ? orderBy.map(col => this.escapeName(col)).join(', ') : this.escapeName(orderBy);
      queryParts.push(`ORDER BY ${orderClause}`);
    }
    if (limit) queryParts.push(`LIMIT ${parseInt(limit, 10)}`);
    if (offset) queryParts.push(`OFFSET ${parseInt(offset, 10)}`);

    const query = queryParts.join(' ');

    const result = await this.db.any(query, values);
    return result;
  }

  /**
   * Finds the first row matching the given conditions.
   * @param {Array<Object>} conditions - Condition list.
   * @param {Object} [options] - Query options (same as findWhere).
   * @returns {Promise<Object|null>} First matching row or null.
   */
  async findOneBy(conditions, options = {}) {
    const results = await this.findWhere(conditions, 'AND', options);
    return results[0] || null;
  }

  // ---------------------------------------------------------------------------
  // 🟠 Query & Filtering
  // ---------------------------------------------------------------------------
  /**
   * Retrieves a paginated set of rows after a cursor position.
   * @param {Object} cursor - Cursor values keyed by orderBy columns.
   * @param {number} limit - Max number of rows to return.
   * @param {Array<string>} orderBy - Columns used for pagination ordering.
   * @param {Object} options - Query options.
   * @param {Array<string>} [options.columnWhitelist] - Columns to return.
   * @param {Object} [options.filters] - Additional filter object.
   * @param {boolean} [options.includeDeactivated=false] - Include soft-deleted records when true.
   * @returns {Promise<{rows: Object[], nextCursor: Object|null}>} Paginated result.
   */
  async findAfterCursor(cursor = {}, limit = 50, orderBy = ['id'], options = {}) {
    try {
      const { descending = false, columnWhitelist = null, filters = {}, includeDeactivated = false } = options;
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
          const top = filters.and ? this.buildCondition(filters.and, 'AND', values) : this.buildCondition(filters.or, 'OR', values);
          whereClauses.push(top);
        } else {
          whereClauses.push(this.buildCondition([filters], 'AND', values));
        }
      }
      if (this._schema.softDelete && !includeDeactivated) {
        whereClauses.push('deactivated_at IS NULL');
      }
      if (whereClauses.length) {
        queryParts.push('WHERE', whereClauses.join(' AND '));
      }
      queryParts.push(`ORDER BY ${escapedOrderCols} ${direction}`);
      queryParts.push(`LIMIT $${values.length + 1}`);
      values.push(limit);
      const query = queryParts.join(' ');

      // Execute the query
      const rows = await this.db.any(query, values);
      const nextCursor =
        rows.length > 0
          ? orderBy.reduce((acc, col) => {
              acc[col] = rows[rows.length - 1][col];
              return acc;
            }, {})
          : null;
      return { rows, nextCursor };
    } catch (err) {
      console.error('Error occurred while finding after cursor:', err);
      throw err;
    }
  }

  /**
   * Reloads a single record by ID using findById.
   * @param {string|number} id - Primary key value.
   * @param {Object} [options] - Optional flags.
   * @param {boolean} [options.includeDeactivated=false] - Whether to include soft-deleted records.
   * @returns {Promise<Object|null>} The found record or null.
   */
  async reload(id, { includeDeactivated = false } = {}) {
    return this.findById(id, { includeDeactivated });
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
    const { includeDeactivated, ...rest } = options;
    const rows = await this.findWhere(where, joinType, { ...rest, includeDeactivated });
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(this._schema.table);

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
   * Checks if any row exists matching the given conditions.
   * @param {Object} conditions - Condition object.
   * @param {Object} [options] - Query options.
   * @returns {Promise<boolean>} True if a match is found.
   * @throws {Error} If conditions are invalid.
   */
  async exists(conditions, options = {}) {
    if (!isPlainObject(conditions) || Object.keys(conditions).length === 0) {
      return Promise.reject(Error('Conditions must be a non-empty object'));
    }
    const { clause, values } = this.buildWhereClause(conditions, true, [], 'AND', options.includeDeactivated === true);
    const query = `SELECT EXISTS (SELECT 1 FROM ${this.schemaName}.${this.tableName} WHERE ${clause}) AS "exists"`;
    try {
      const result = await this.db.one(query, values);
      return result.exists;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Counts the number of rows matching a WHERE clause.
   * @param {Array<Object>} conditions - Array of condition objects.
   * @param {string} joinType - Logical joiner ('AND' or 'OR').
   * @param {Object} options - Query options.
   * @param {Object} [options.filters] - Additional filter object.
   * @param {boolean} [options.includeDeactivated=false] - Include soft-deleted records when true.
   * @returns {Promise<number>} Number of matching rows.
   */
  async countWhere(conditions = [], joinType = 'AND', { filters = {}, includeDeactivated = false } = {}) {
    const values = [];
    const whereClauses = [];

    if (conditions.length > 0) {
      const { clause, values: builtValues } = this.buildWhereClause(conditions, true, [], joinType, includeDeactivated);
      values.push(...builtValues);
      whereClauses.push(`(${clause})`);
    }

    if (Object.keys(filters).length) {
      whereClauses.push(this.buildCondition([filters], 'AND', values));
    }

    const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName} ${whereStr}`;

    try {
      const result = await this.db.one(query, values);
      return parseInt(result.count, 10);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Counts all rows in the table.
   * @param {Object} [options] - Query options.
   * @param {boolean} [options.includeDeactivated=false] - Include soft-deleted records when true.
   * @returns {Promise<number>} Total row count.
   */
  async countAll({ includeDeactivated = false } = {}) {
    let query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName}`;
    if (this._schema.softDelete && !includeDeactivated) {
      query += ` WHERE deactivated_at IS NULL`;
    }
    try {
      const result = await this.db.one(query);
      return parseInt(result.count, 10);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🟣 Utilities
  // ---------------------------------------------------------------------------
  /**
   * Generates a SQL-safe VALUES clause using this model's ColumnSet.
   * @param {Array<Object|Array>} data - Array of rows (object or array form)
   * @returns {string} VALUES clause for direct embedding in SQL
   */
  buildValuesClause(data) {
    if (!Array.isArray(data) || data.length === 0) return '';
    return this.pgp.helpers.values(data, this.cs);
  }
  
  /**
   * Validates a single DTO or an array of DTOs using a Zod validator.
   *
   * @param {Object|Object[]} data - The DTO or array of DTOs to validate.
   * @param {import('zod').ZodTypeAny} validator - A Zod schema used for validation.
   * @param {string} [type='DTO'] - Optional label used in error messages.
   * @throws {SchemaDefinitionError} If validation fails. The `.cause` property contains Zod error details.
   */
  validateDto(data, validator, type = 'DTO') {
    try {
      if (Array.isArray(data)) {
        validator.array().parse(data);
      } else {
        validator.parse(data);
      }
    } catch (err) {
      const error = new SchemaDefinitionError(`${type} validation failed`);
      error.cause = err.errors || err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error(`${type} validation failed: ${error.message}`, { cause: error.cause });
      }
      throw error;
    }
  }

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
   * Escapes a column or table name using pg-promise syntax.
   * @param {string} name - Unescaped identifier.
   * @returns {string} Escaped name.
   */
  escapeName(name) {
    return this.pgp.as.name(name);
  }

  get schema() {
    return this._schema;
  }

  get schemaName() {
    return this.escapeName(this._schema.dbSchema);
  }

  /**
   * Sets a new schema name and regenerates the column set.
   * @param {string} name - The new schema name.
   * @returns {QueryModel} The updated model instance.
   * @throws {Error} If name is invalid.
   */
  setSchemaName(name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Schema name must be a non-empty string');
    }

    const clonedSchema = cloneDeep(this._schema);
    clonedSchema.dbSchema = name;
    this.cs = createColumnSet(clonedSchema, this.pgp);
    this._schema = clonedSchema;

    return this;
  }

  get tableName() {
    return this.escapeName(this._schema.table);
  }

  // ---------------------------------------------------------------------------
  // 🔴 Internals
  // ---------------------------------------------------------------------------

  /**
   * Builds a SQL WHERE clause from conditions.
   * @param {Object|Array<Object>} where - Conditions object or array.
   * @param {boolean} [requireNonEmpty=true] - Enforce non-empty input.
   * @param {Array} [values=[]] - Array to accumulate parameter values.
   * @param {string} [joinType='AND'] - Logical operator for combining.
   * @param {boolean} [includeDeactivated=false] - Include soft-deleted records if true.
   * @returns {{ clause: string, values: Array }} Clause and parameter list.
   * @throws {Error} If input is invalid or empty when required.
   */
  buildWhereClause(where = {}, requireNonEmpty = true, values = [], joinType = 'AND', includeDeactivated = false) {
    const isValidArray = Array.isArray(where);
    const isValidObject = isPlainObject(where);

    let clause;
    if (isValidArray) {
      if (requireNonEmpty && where.length === 0) {
        throw new Error('WHERE clause must be a non-empty array');
      }
      clause = this.buildCondition(where, joinType, values);
    } else if (isValidObject) {
      const isEmptyObject = Object.keys(where).length === 0;
      if (requireNonEmpty && isEmptyObject) {
        throw new Error('WHERE clause must be a non-empty object');
      }
      clause = this.buildCondition([where], joinType, values);
    } else {
      throw new Error('WHERE clause must be an array or plain object');
    }

    // Refactored logic for soft delete handling
    if (this._schema.softDelete && !includeDeactivated) {
      clause += clause ? ' AND deactivated_at IS NULL' : 'deactivated_at IS NULL';
    }

    return { clause, values };
  }

  /**
   * Builds a SQL fragment from a group of conditions, supporting nested logic and advanced operators.
   *
   * 🔍 Supports field-level modifiers like `$like`, `$from`, `$in`, etc.
   * 🔁 Also supports nested boolean logic via `$and`, `$or`, `and`, `or`.
   *
   * 📘 See full documentation:
   * [WHERE Clause Modifiers Reference](where-modifiers.md)
   *
   * @param {Array<Object>} group - Array of condition objects.
   * @param {string} joiner - Logical joiner ('AND' or 'OR') between conditions.
   * @param {Array} values - Parameter values to be populated.
   * @returns {string} A SQL-safe WHERE fragment.
   */
  buildCondition(group, joiner = 'AND', values = []) {
    const parts = [];
    for (const item of group) {
      if (item.$and && Array.isArray(item.$and) && item.$and.length > 0) {
        parts.push(`(${this.buildCondition(item.$and, 'AND', values)})`);
        continue;
      } else if (item.$or && Array.isArray(item.$or) && item.$or.length > 0) {
        parts.push(`(${this.buildCondition(item.$or, 'OR', values)})`);
        continue;
      }
      if (item.and && Array.isArray(item.and) && item.and.length > 0) {
        parts.push(`(${this.buildCondition(item.and, 'AND', values)})`);
      } else if (item.or && Array.isArray(item.or) && item.or.length > 0) {
        parts.push(`(${this.buildCondition(item.or, 'OR', values)})`);
      } else {
        for (const [key, val] of Object.entries(item)) {
          const col = this.escapeName(key);
          if (val && typeof val === 'object') {
            const supportedKeys = ['$like', '$ilike', '$from', '$to', '$in', '$eq', '$ne', '$max', '$min', '$sum', '$not', '$is'];
            const keys = Object.keys(val);
            const unsupported = keys.filter(k => !supportedKeys.includes(k));
            if (unsupported.length > 0) {
              throw new SchemaDefinitionError(`Unsupported operator: ${unsupported[0]}`);
            }

            if ('$like' in val) {
              values.push(val['$like']);
              parts.push(`${col} LIKE $${values.length}`);
            }
            if ('$ilike' in val) {
              values.push(val['$ilike']);
              parts.push(`${col} ILIKE $${values.length}`);
            }
            if ('$from' in val) {
              values.push(val['$from']);
              parts.push(`${col} >= $${values.length}`);
            }
            if ('$to' in val) {
              values.push(val['$to']);
              parts.push(`${col} <= $${values.length}`);
            }
            if ('$in' in val) {
              if (!Array.isArray(val['$in']) || val['$in'].length === 0) {
                throw new SchemaDefinitionError(`$IN clause must be a non-empty array`);
              }
              const placeholders = val['$in']
                .map(v => {
                  values.push(v);
                  return `$${values.length}`;
                })
                .join(', ');
              parts.push(`${col} IN (${placeholders})`);
            }
            if ('$eq' in val) {
              values.push(val['$eq']);
              parts.push(`${col} = $${values.length}`);
            }
            if ('$ne' in val) {
              if (val['$ne'] === null) {
                parts.push(`${col} IS NOT NULL`);
              } else {
                values.push(val['$ne']);
                parts.push(`${col} != $${values.length}`);
              }
            }
            // Handle $not
            if ('$not' in val) {
              if (val['$not'] === null) {
                parts.push(`${col} IS NOT NULL`);
              } else {
                throw new SchemaDefinitionError(`$not only supports null for now`);
              }
            }
            // Handle $is
            if ('$is' in val) {
              if (val['$is'] === null) {
                parts.push(`${col} IS NULL`);
              } else {
                throw new SchemaDefinitionError(`$is only supports null for now`);
              }
            }
            if ('$max' in val) {
              parts.push(`${col} = (SELECT MAX(${col}) FROM ${this.schemaName}.${this.tableName})`);
            }
            if ('$min' in val) {
              parts.push(`${col} = (SELECT MIN(${col}) FROM ${this.schemaName}.${this.tableName})`);
            }
            if ('$sum' in val) {
              parts.push(`${col} = (SELECT SUM(${col}) FROM ${this.schemaName}.${this.tableName})`);
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
  /**
   * Handles known pg errors and logs them.
   * @param {Error} err - The error thrown by pg-promise.
   * @throws {DatabaseError} Translated database error.
   */
  handleDbError(err) {
    if (this.logger?.error) {
      this.logger.error(`[DB ERROR] (${this._schema.dbSchema}.${this._schema.table})`, {
        message: err.message,
        code: err.code,
        detail: err.detail,
        stack: err.stack,
      });
    }

    switch (err.code) {
      case '23505':
        throw new DatabaseError('Unique constraint violation', err);
      case '23503':
        throw new DatabaseError('Foreign key constraint violation', err);
      case '23514':
        throw new DatabaseError('Check constraint violation', err);
      case '22P02':
        throw new DatabaseError('Invalid input syntax for type', err);
      default:
        throw new DatabaseError('Database operation failed', err);
    }
  }
}

export default QueryModel;
export { QueryModel };