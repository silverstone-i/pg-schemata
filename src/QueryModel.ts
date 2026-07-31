/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { LRUCache } from 'lru-cache';
import {
  createColumnSet,
  addAuditFields,
  addSoftDeleteField,
} from './utils/schemaBuilder.js';
import { isValidId, isPlainObject } from './utils/validation.js';
import DatabaseError from './DatabaseError.js';
import type { PgErrorLike } from './DatabaseError.js';
import SchemaDefinitionError from './SchemaDefinitionError.js';
import { logMessage } from './utils/pg-util.js';
import { CONDITION_OPERATORS, PG_ERROR_MESSAGES } from './queryTypes.js';
import type {
  CursorOptions,
  CursorPage,
  FieldConditions,
  FiltersInput,
  FindOptions,
  JoinType,
  PgErrorCode,
  QueryOptions,
  WhereClauseResult,
  WhereCondition,
  WhereInput,
} from './queryTypes.js';
import type { DbConnection, Logger, Row, TableSchema } from './schemaTypes.js';
import type {
  NormalizedTableSchema,
  TableColumnSets,
} from './internalTypes.js';
import type { IMain } from 'pg-promise';
import type { ColumnSet } from 'pg-promise';
import { ZodError } from 'zod';
import type { ZodTypeAny } from 'zod';
import _ from 'lodash';
const { cloneDeep } = _;

/**
 * A condition node with every recognized boolean-logic key made visible for
 * narrowing. The runtime accepts any mix of these keys on one object.
 */
type ConditionNode = FieldConditions & {
  $and?: WhereCondition[];
  $or?: WhereCondition[];
  and?: WhereCondition[];
  or?: WhereCondition[];
};

// Cache of schema-bound clones produced by forSchema(), same bounds as the
// ColumnSet cache in schemaBuilder. Keys are namespaced per base instance:
// pg-promise's `extend` re-creates repositories for every task/transaction
// with a different executor, so clones must never be shared across bases —
// a transaction-context caller would otherwise receive a clone bound to the
// root pool.
const modelCloneCache = new LRUCache<string, object>({
  max: 20000,
  ttl: 1000 * 60 * 60,
});
let nextCloneCacheId = 1;
let setSchemaNameDeprecationWarned = false;
let nullableAliasWarned = false;

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
 *
 * The row type defaults to `any` for backward compatibility; extend with an
 * explicit row interface (`class Users extends TableModel<UserRow>`) to get
 * typed query results.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class QueryModel<TRow = any> {
  db: DbConnection;
  pgp: IMain;
  logger: Logger | null;
  _schema: NormalizedTableSchema;
  cs: TableColumnSets;
  private _cloneCacheId?: number;

  constructor(
    db: DbConnection,
    pgp: IMain,
    schema: TableSchema,
    logger: Logger | null = null
  ) {
    if (!schema || typeof schema !== 'object') {
      throw new Error('Schema must be an object');
    }
    if (!db || !pgp || !schema.table || !schema.columns) {
      throw new Error(
        'Missing required parameters: db, pgp, schema.table, or schema.columns'
      );
    }

    this.db = db;
    this.pgp = pgp;
    this.logger = logger;
    // Clone before normalizing so the caller's schema object is never mutated.
    // Both helpers guard internally, so they run unconditionally — gating on
    // hasAuditFields here would skip the soft-delete column too (issue N1).
    const working = cloneDeep(schema);
    this._normalizeNullableColumns(working);
    addAuditFields(working);
    addSoftDeleteField(working);
    this._schema = working;
    this.cs = createColumnSet(this.schema, this.pgp);
  }

  // ---------------------------------------------------------------------------
  // 🟢 Basic Queries
  // ---------------------------------------------------------------------------
  /**
   * Finds only soft-deleted records.
   * @param conditions - Optional extra conditions.
   * @param joinType - Logical joiner ('AND' or 'OR').
   * @param options - Query options.
   * @returns Soft-deleted rows.
   */
  async findSoftDeleted(
    conditions: WhereCondition[] = [],
    joinType: JoinType = 'AND',
    options: FindOptions = {}
  ): Promise<TRow[]> {
    if (!this._schema.softDelete) {
      return Promise.reject(
        new Error('Soft delete is not enabled for this table.')
      );
    }
    return this.findWhere(
      [...conditions, { deactivated_at: { $ne: null } }],
      joinType,
      { ...options, includeDeactivated: true }
    );
  }

  /**
   * Checks if a specific record is soft-deleted.
   * @param id - The primary key value.
   * @returns True if the record is soft-deleted, false otherwise.
   */
  async isSoftDeleted(id: number | string): Promise<boolean> {
    if (!this._schema.softDelete) {
      return Promise.reject(
        new Error('Soft delete is not enabled for this table.')
      );
    }
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.exists(
      { id, deactivated_at: { $ne: null } },
      { includeDeactivated: true }
    );
  }

  /**
   * Fetches all rows from the table with optional pagination.
   * @param options.limit - Maximum number of records to return (default 50).
   * @param options.offset - Number of records to skip (default 0).
   * @returns List of rows.
   */
  async findAll({
    limit = 50,
    offset = 0,
  }: { limit?: number; offset?: number } = {}): Promise<TRow[]> {
    return this.findWhere([], 'AND', { limit, offset, orderBy: 'id' });
  }

  /**
   * Finds a single row by its ID.
   * @param id - The primary key value.
   * @returns Matching row or null if not found.
   * @throws {Error} If ID is invalid.
   */
  async findById(id: number | string): Promise<TRow | null> {
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.findOneBy([{ id }]);
  }

  /**
   * Finds a single row by its ID, including soft-deleted records.
   * @param id - The primary key value.
   * @returns Matching row or null if not found.
   * @throws {Error} If ID is invalid.
   */
  async findByIdIncludingDeactivated(
    id: number | string
  ): Promise<TRow | null> {
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.findOneBy([{ id }], { includeDeactivated: true });
  }

  /**
   * Finds rows matching conditions and optional filters.
   * @param conditions - Array of condition objects.
   * @param joinType - Logical operator ('AND' or 'OR').
   * @param options - Query options (columnWhitelist, filters, orderBy, limit, offset, includeDeactivated).
   * @returns Matching rows.
   */
  async findWhere(
    conditions: WhereInput = [],
    joinType: JoinType = 'AND',
    {
      columnWhitelist = null,
      filters = {},
      orderBy = null,
      limit = null,
      offset = null,
      includeDeactivated = false,
    }: FindOptions = {}
  ): Promise<TRow[]> {
    const normalized = this._normalizeConditions(conditions);

    const table = `${this.schemaName}.${this.tableName}`;
    const selectCols = columnWhitelist?.length
      ? columnWhitelist.map(col => this.escapeName(col)).join(', ')
      : '*';
    const queryParts = [`SELECT ${selectCols} FROM ${table}`];
    const values: unknown[] = [];
    const whereClauses: string[] = [];

    if (normalized.length > 0) {
      const { clause, values: builtValues } = this._buildWhereClause(
        normalized,
        true,
        [],
        joinType,
        includeDeactivated === true
      );
      values.push(...builtValues);
      whereClauses.push(`(${clause})`);
    }

    if (Object.keys(filters).length) {
      whereClauses.push(
        this.buildCondition(
          [filters] as WhereCondition[],
          'AND',
          values,
          includeDeactivated === true
        )
      );
    }

    const guard = this.softDeleteGuard(includeDeactivated);
    if (guard) whereClauses.push(guard);

    if (whereClauses.length)
      queryParts.push('WHERE', whereClauses.join(' AND '));
    if (orderBy) {
      const orderClause = Array.isArray(orderBy)
        ? orderBy.map(col => this.escapeName(col)).join(', ')
        : this.escapeName(orderBy);
      queryParts.push(`ORDER BY ${orderClause}`);
    }
    // Validate instead of interpolating parseInt output: bad input produced
    // LIMIT NaN, and the old truthiness gate dropped limit: 0 / offset: 0
    // (suggestion 5).
    if (limit != null)
      queryParts.push(`LIMIT ${this._toBoundedInt(limit, 'limit')}`);
    if (offset != null)
      queryParts.push(`OFFSET ${this._toBoundedInt(offset, 'offset')}`);

    const query = queryParts.join(' ');

    const result = await this.db.any<TRow>(query, values);
    return result;
  }

  /**
   * Finds the first row matching the given conditions.
   * @param conditions - Condition list.
   * @param options - Query options (same as findWhere).
   * @returns First matching row or null.
   */
  async findOneBy(
    conditions: WhereInput,
    options: FindOptions = {}
  ): Promise<TRow | null> {
    const results = await this.findWhere(conditions, 'AND', options);
    return results[0] || null;
  }

  // ---------------------------------------------------------------------------
  // 🟠 Query & Filtering
  // ---------------------------------------------------------------------------
  /**
   * Retrieves a paginated set of rows after a cursor position.
   * @param cursor - Cursor values keyed by orderBy columns.
   * @param limit - Max number of rows to return.
   * @param orderBy - Columns used for pagination ordering.
   * @param options - Query options (descending, columnWhitelist, filters, includeDeactivated).
   * @returns Paginated result.
   */
  async findAfterCursor(
    cursor: Record<string, unknown> = {},
    limit = 50,
    orderBy: string[] = ['id'],
    options: CursorOptions = {}
  ): Promise<CursorPage<TRow>> {
    try {
      const {
        descending = false,
        columnWhitelist = null,
        filters = {},
        includeDeactivated = false,
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
      const whereClauses: string[] = [];
      const values: unknown[] = [];
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
            ? this.buildCondition(
                filters.and,
                'AND',
                values,
                includeDeactivated === true
              )
            : this.buildCondition(
                filters.or ?? [],
                'OR',
                values,
                includeDeactivated === true
              );
          whereClauses.push(top);
        } else {
          whereClauses.push(
            this.buildCondition(
              [filters] as WhereCondition[],
              'AND',
              values,
              includeDeactivated === true
            )
          );
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
      const rows = await this.db.any<TRow>(query, values);
      const lastRow = rows[rows.length - 1];
      const nextCursor =
        lastRow !== undefined
          ? orderBy.reduce<Record<string, unknown>>((acc, col) => {
              acc[col] = (lastRow as Row)[col];
              return acc;
            }, {})
          : null;
      return { rows, nextCursor };
    } catch (err) {
      const level = err instanceof DatabaseError ? 'error' : 'debug';
      logMessage({
        logger: this.logger,
        level,
        schema: this._schema.dbSchema,
        table: this._schema.table,
        message: `findAfterCursor failure: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  /**
   * Reloads a single record by ID.
   * @param id - Primary key value.
   * @param options.includeDeactivated - Whether to include soft-deleted records.
   * @returns The found record or null.
   * @throws {Error} If ID is invalid.
   */
  async reload(
    id: number | string,
    { includeDeactivated = false }: QueryOptions = {}
  ): Promise<TRow | null> {
    // findById takes only an id, so route through findOneBy to honor options
    // (issue 10).
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.findOneBy([{ id }], { includeDeactivated });
  }

  /**
   * Exports table data to an Excel file based on filter criteria.
   * @param filePath - Destination .xlsx path.
   * @param where - Optional conditions.
   * @param joinType - Join type between conditions.
   * @param options - Additional query options.
   */
  async exportToSpreadsheet(
    filePath: string,
    where: WhereInput = [],
    joinType: JoinType = 'AND',
    options: FindOptions = {}
  ): Promise<{ exported: number; filePath: string }> {
    const { includeDeactivated, ...rest } = options;
    const rows = await this.findWhere(where, joinType, {
      ...rest,
      includeDeactivated,
    });
    const { WorkbookBuilder, writeXlsx } = await import('@nap-sft/tablsx');
    const { writeFileSync } = await import('node:fs');
    const wb = WorkbookBuilder.create();
    const sheet = wb.sheet(this._schema.table);

    const firstRow = rows[0] as Row | undefined;
    if (firstRow === undefined) {
      sheet.addRow(['No data found']);
    } else {
      sheet.setHeaders(Object.keys(firstRow));
      sheet.addObjects(rows as Row[]);
    }

    const bytes = writeXlsx(wb.build());
    writeFileSync(filePath, bytes);

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
   * @param conditions - Condition object.
   * @param options - Query options.
   * @returns True if a match is found.
   * @throws {Error} If conditions are invalid.
   */
  async exists(
    conditions: FieldConditions,
    options: QueryOptions = {}
  ): Promise<boolean> {
    if (!isPlainObject(conditions) || Object.keys(conditions).length === 0) {
      return Promise.reject(Error('Conditions must be a non-empty object'));
    }
    const { clause, values } = this.buildWhereClause(
      conditions,
      true,
      [],
      'AND',
      options.includeDeactivated === true
    );
    const query = `SELECT EXISTS (SELECT 1 FROM ${this.schemaName}.${this.tableName} WHERE ${clause}) AS "exists"`;
    try {
      const result = await this.db.one<{ exists: boolean }>(query, values);
      return result.exists;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Counts the number of rows matching a WHERE clause.
   * @param conditions - Array of condition objects.
   * @param joinType - Logical joiner ('AND' or 'OR').
   * @param options - Query options (filters, includeDeactivated).
   * @returns Number of matching rows.
   */
  async countWhere(
    conditions: WhereInput = [],
    joinType: JoinType = 'AND',
    {
      filters = {},
      includeDeactivated = false,
    }: { filters?: FiltersInput } & QueryOptions = {}
  ): Promise<number> {
    const normalized = this._normalizeConditions(conditions);

    const values: unknown[] = [];
    const whereClauses: string[] = [];

    if (normalized.length > 0) {
      const { clause, values: builtValues } = this._buildWhereClause(
        normalized,
        true,
        [],
        joinType,
        includeDeactivated
      );
      values.push(...builtValues);
      whereClauses.push(`(${clause})`);
    }

    if (Object.keys(filters).length) {
      whereClauses.push(
        this.buildCondition(
          [filters] as WhereCondition[],
          'AND',
          values,
          includeDeactivated === true
        )
      );
    }

    const guard = this.softDeleteGuard(includeDeactivated);
    if (guard) whereClauses.push(guard);

    const whereStr = whereClauses.length
      ? `WHERE ${whereClauses.join(' AND ')}`
      : '';
    const query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName} ${whereStr}`;

    try {
      // pg returns bigint counts as strings; parseInt converts.
      const result = await this.db.one<{ count: string }>(query, values);
      return parseInt(result.count, 10);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Counts all rows in the table.
   * @param options.includeDeactivated - Include soft-deleted records when true.
   * @returns Total row count.
   */
  async countAll({
    includeDeactivated = false,
  }: QueryOptions = {}): Promise<number> {
    let query = `SELECT COUNT(*) FROM ${this.schemaName}.${this.tableName}`;
    if (this._schema.softDelete && !includeDeactivated) {
      query += ` WHERE deactivated_at IS NULL`;
    }
    try {
      const result = await this.db.one<{ count: string }>(query);
      return parseInt(result.count, 10);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🟣 Utilities
  // ---------------------------------------------------------------------------
  /**
   * The base ColumnSet for this model's table. Guaranteed by construction;
   * the guard keeps indexed access honest.
   */
  private get _baseCs(): ColumnSet<unknown> {
    const cs = this.cs[this._schema.table];
    if (!cs) {
      throw new SchemaDefinitionError(
        `No ColumnSet for table ${this._schema.table}`
      );
    }
    return cs;
  }

  /**
   * Generates a SQL-safe VALUES clause using this model's ColumnSet.
   * @param data - Array of rows (object or array form)
   * @returns VALUES clause for direct embedding in SQL
   */
  buildValuesClause(data: Array<Row | unknown[]>): string {
    if (!Array.isArray(data) || data.length === 0) return '';
    // this.cs is the container { [table], insert, update }; helpers.values
    // needs the ColumnSet itself (issue 13).
    return this.pgp.helpers.values(data, this._baseCs);
  }

  /**
   * Validates a single DTO or an array of DTOs using a Zod validator.
   *
   * @param data - The DTO or array of DTOs to validate.
   * @param validator - A Zod schema used for validation.
   * @param type - Optional label used in error messages.
   * @throws {SchemaDefinitionError} If validation fails. The `.cause` property contains Zod error details.
   */
  validateDto(data: unknown, validator: ZodTypeAny, type = 'DTO'): void {
    try {
      if (Array.isArray(data)) {
        validator.array().parse(data);
      } else {
        validator.parse(data);
      }
    } catch (err) {
      const error = new SchemaDefinitionError(`${type} validation failed`);
      error.cause = err instanceof ZodError ? err.errors : err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error?.(`${type} validation failed: ${error.message}`, {
          cause: error.cause,
        });
      }
      throw error;
    }
  }

  /**
   * Returns a sanitized copy of the input, filtering out invalid or immutable columns.
   * @param dto - Input object.
   * @param options.includeImmutable - Keep immutable columns (default true).
   * @returns Sanitized DTO.
   */
  sanitizeDto(
    dto: Row,
    { includeImmutable = true }: { includeImmutable?: boolean } = {}
  ): Row {
    const validColumns = this._schema.columns
      .filter(c => includeImmutable || !c.immutable)
      .map(c => c.name);
    const sanitized: Row = {};
    for (const key in dto) {
      if (validColumns.includes(key)) {
        sanitized[key] = dto[key];
      }
    }
    return sanitized;
  }

  /**
   * Escapes a column or table name using pg-promise syntax.
   * @param name - Unescaped identifier.
   * @returns Escaped name.
   */
  escapeName(name: string): string {
    return this.pgp.as.name(name);
  }

  get schema(): NormalizedTableSchema {
    return this._schema;
  }

  get schemaName(): string {
    return this.escapeName(this._schema.dbSchema);
  }

  /**
   * Returns a model bound to the given schema without mutating this instance.
   *
   * Clones are created once per (instance, schema) pair and cached, so
   * concurrent requests targeting different schemas each hold their own
   * model and cannot overwrite each other's schema state — the race that
   * makes setSchemaName() unsafe on a shared repository.
   *
   * @param name - The schema name to bind.
   * @returns This instance if already bound to `name`, otherwise a cached clone.
   * @throws {Error} If name is invalid.
   */
  forSchema(name: string): this {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Schema name must be a non-empty string');
    }
    if (name === this._schema.dbSchema) return this;

    this._cloneCacheId ??= nextCloneCacheId++;
    const key = `${this._cloneCacheId}::${this._schema.table}::${name}`;
    // The cache is heterogeneous across model classes; the key namespacing
    // guarantees the entry was produced from this instance.
    let clone = modelCloneCache.get(key) as this | undefined;
    if (!clone) {
      clone = Object.create(Object.getPrototypeOf(this)) as this;
      Object.assign(clone, this);
      clone._schema = { ...this._schema, dbSchema: name };
      clone.cs = createColumnSet(clone._schema, this.pgp);
      modelCloneCache.set(key, clone);
    }
    return clone;
  }

  /**
   * Sets a new schema name and regenerates the column set.
   *
   * @deprecated Mutates this instance in place: two interleaved requests on a
   * shared repository race on the schema and can write to the wrong tenant.
   * Use {@link QueryModel#forSchema} instead.
   * @param name - The new schema name.
   * @returns The updated model instance.
   * @throws {Error} If name is invalid.
   */
  setSchemaName(name: string): this {
    if (!setSchemaNameDeprecationWarned) {
      setSchemaNameDeprecationWarned = true;
      console.warn(
        '[pg-schemata] setSchemaName() is deprecated: it mutates the shared model instance and races under concurrent requests. Use forSchema() instead.'
      );
    }
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('Schema name must be a non-empty string');
    }

    const clonedSchema = cloneDeep(this._schema);
    clonedSchema.dbSchema = name;
    this.cs = createColumnSet(clonedSchema, this.pgp);
    this._schema = clonedSchema;

    return this;
  }

  get tableName(): string {
    return this.escapeName(this._schema.table);
  }

  // ---------------------------------------------------------------------------
  // 🔴 Internals
  // ---------------------------------------------------------------------------

  /**
   * Maps the deprecated column key `nullable` onto `notNull`.
   *
   * Nothing in DDL generation or validator generation ever read `nullable`,
   * so schemas using it silently produced fully nullable tables (issue N6).
   * `nullable: false` now means `notNull: true`; `nullable: true` matches the
   * default and is dropped. Emits a one-time deprecation warning.
   *
   * @param schema - Cloned schema to normalize in place.
   */
  _normalizeNullableColumns(schema: TableSchema): void {
    if (!Array.isArray(schema.columns)) return;
    for (const col of schema.columns) {
      if (!Object.prototype.hasOwnProperty.call(col, 'nullable')) continue;
      if (!nullableAliasWarned) {
        nullableAliasWarned = true;
        console.warn(
          `[pg-schemata] Column "${col.name}" in "${schema.table}" uses the deprecated key "nullable"; use "notNull" instead. "nullable: false" is treated as "notNull: true". This alias will be removed in 2.0.0.`
        );
      }
      if (
        col.nullable === false &&
        !Object.prototype.hasOwnProperty.call(col, 'notNull')
      ) {
        col.notNull = true;
      }
      delete col.nullable;
    }
  }

  /**
   * Validates a LIMIT/OFFSET value as a non-negative integer.
   * @param value - Caller-supplied limit or offset.
   * @param label - Name used in the error message.
   * @returns The validated integer.
   * @throws {SchemaDefinitionError} If value is not a non-negative integer.
   */
  _toBoundedInt(value: number | string, label: string): number {
    const n =
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      throw new SchemaDefinitionError(
        `Invalid ${label}: ${JSON.stringify(value)}`
      );
    }
    return n;
  }

  /**
   * Normalizes a conditions argument to an array of condition objects.
   *
   * A plain object is wrapped in an array so callers may pass either shape —
   * previously an object slipped past the `conditions.length` checks and the
   * WHERE clause was silently dropped (issue 9). Anything else throws.
   *
   * @param conditions - Conditions in either shape.
   * @returns Conditions as an array.
   * @throws {SchemaDefinitionError} If conditions is neither an array nor a plain object.
   */
  _normalizeConditions(conditions: WhereInput): WhereCondition[] {
    if (Array.isArray(conditions)) return conditions;
    if (isPlainObject(conditions))
      return Object.keys(conditions).length ? [conditions] : [];
    throw new SchemaDefinitionError(
      'Conditions must be an array or a plain object'
    );
  }

  /**
   * Builds a SQL WHERE clause from conditions.
   * @param where - Conditions object or array.
   * @param requireNonEmpty - Enforce non-empty input.
   * @param values - Array to accumulate parameter values.
   * @param joinType - Logical operator for combining.
   * @param includeDeactivated - Include soft-deleted records if true.
   * @returns Clause and parameter list.
   * @throws {Error} If input is invalid or empty when required.
   */
  buildWhereClause(
    where: WhereInput = {},
    requireNonEmpty = true,
    values: unknown[] = [],
    joinType: JoinType = 'AND',
    includeDeactivated = false
  ): WhereClauseResult {
    const result = this._buildWhereClause(
      where,
      requireNonEmpty,
      values,
      joinType,
      includeDeactivated
    );
    // Documented public API: the returned clause honors includeDeactivated,
    // matching pre-1.4 behavior for external callers.
    const guard = this.softDeleteGuard(includeDeactivated);
    if (guard) {
      result.clause += result.clause ? ` AND ${guard}` : guard;
    }
    return result;
  }

  /**
   * @private
   *
   * Core WHERE-clause builder without the soft-delete guard. Internal query
   * methods use this and append softDeleteGuard() once themselves, because
   * their filters branches never pass through here — injecting the guard at
   * this layer left filters-only queries unguarded (issue 8) while other
   * callers stacked a second copy on top (N9). includeDeactivated is still
   * threaded into buildCondition for the aggregate subqueries.
   *
   * @param where - Conditions object or array.
   * @param requireNonEmpty - Enforce non-empty input.
   * @param values - Array to accumulate parameter values.
   * @param joinType - Logical operator for combining.
   * @param includeDeactivated - Include soft-deleted records if true.
   * @returns Clause and parameter list.
   */
  _buildWhereClause(
    where: WhereInput = {},
    requireNonEmpty = true,
    values: unknown[] = [],
    joinType: JoinType = 'AND',
    includeDeactivated = false
  ): WhereClauseResult {
    const isValidObject = isPlainObject(where);

    let clause;
    if (Array.isArray(where)) {
      if (requireNonEmpty && where.length === 0) {
        throw new Error('WHERE clause must be a non-empty array');
      }
      clause = this.buildCondition(where, joinType, values, includeDeactivated);
    } else if (isValidObject) {
      const isEmptyObject = Object.keys(where).length === 0;
      if (requireNonEmpty && isEmptyObject) {
        throw new Error('WHERE clause must be a non-empty object');
      }
      clause = this.buildCondition(
        [where],
        joinType,
        values,
        includeDeactivated
      );
    } else {
      throw new Error('WHERE clause must be an array or plain object');
    }

    return { clause, values };
  }

  /**
   * The soft-delete predicate for this table, or null when it does not apply.
   * @param includeDeactivated - Include soft-deleted records when true.
   * @returns Predicate fragment or null.
   */
  softDeleteGuard(includeDeactivated = false): string | null {
    return this._schema.softDelete && includeDeactivated !== true
      ? 'deactivated_at IS NULL'
      : null;
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
   * @param group - Array of condition objects.
   * @param joiner - Logical joiner ('AND' or 'OR') between conditions.
   * @param values - Parameter values to be populated.
   * @param includeDeactivated - Include soft-deleted rows in $max/$min/$sum subqueries.
   * @returns A SQL-safe WHERE fragment.
   */
  buildCondition(
    group: WhereCondition[],
    joiner: JoinType = 'AND',
    values: unknown[] = [],
    includeDeactivated = false
  ): string {
    const parts: string[] = [];
    for (const rawItem of group) {
      const item = rawItem as ConditionNode;
      if (item.$and && Array.isArray(item.$and) && item.$and.length > 0) {
        parts.push(
          `(${this.buildCondition(item.$and, 'AND', values, includeDeactivated)})`
        );
        continue;
      } else if (item.$or && Array.isArray(item.$or) && item.$or.length > 0) {
        parts.push(
          `(${this.buildCondition(item.$or, 'OR', values, includeDeactivated)})`
        );
        continue;
      }
      if (item.and && Array.isArray(item.and) && item.and.length > 0) {
        parts.push(
          `(${this.buildCondition(item.and, 'AND', values, includeDeactivated)})`
        );
      } else if (item.or && Array.isArray(item.or) && item.or.length > 0) {
        parts.push(
          `(${this.buildCondition(item.or, 'OR', values, includeDeactivated)})`
        );
      } else {
        for (const [key, val] of Object.entries(item as FieldConditions)) {
          const col = this.escapeName(key);
          if (val && typeof val === 'object') {
            const keys = Object.keys(val);
            const unsupported = keys.filter(
              k => !(CONDITION_OPERATORS as readonly string[]).includes(k)
            );
            if (unsupported.length > 0) {
              throw new SchemaDefinitionError(
                `Unsupported operator: ${unsupported[0]}`
              );
            }

            if ('$like' in val) {
              values.push(val.$like);
              parts.push(`${col} LIKE $${values.length}`);
            }
            if ('$ilike' in val) {
              values.push(val.$ilike);
              parts.push(`${col} ILIKE $${values.length}`);
            }
            if ('$from' in val) {
              values.push(val.$from);
              parts.push(`${col} >= $${values.length}`);
            }
            if ('$to' in val) {
              values.push(val.$to);
              parts.push(`${col} <= $${values.length}`);
            }
            if ('$in' in val) {
              if (!Array.isArray(val.$in) || val.$in.length === 0) {
                throw new SchemaDefinitionError(
                  `$IN clause must be a non-empty array`
                );
              }
              const placeholders = val.$in
                .map(v => {
                  values.push(v);
                  return `$${values.length}`;
                })
                .join(', ');
              parts.push(`${col} IN (${placeholders})`);
            }
            if ('$eq' in val) {
              values.push(val.$eq);
              parts.push(`${col} = $${values.length}`);
            }
            if ('$ne' in val) {
              if (val.$ne === null) {
                parts.push(`${col} IS NOT NULL`);
              } else {
                values.push(val.$ne);
                parts.push(`${col} != $${values.length}`);
              }
            }
            // Handle $not
            if ('$not' in val) {
              if (val.$not === null) {
                parts.push(`${col} IS NOT NULL`);
              } else {
                throw new SchemaDefinitionError(
                  `$not only supports null for now`
                );
              }
            }
            // Handle $is
            if ('$is' in val) {
              if (val.$is === null) {
                parts.push(`${col} IS NULL`);
              } else {
                throw new SchemaDefinitionError(
                  `$is only supports null for now`
                );
              }
            }
            if ('$max' in val || '$min' in val || '$sum' in val) {
              // The subquery must apply the same soft-delete filter as the
              // outer query, or the aggregate can land on a deleted row and
              // the query returns nothing (issue 11).
              const softFilter =
                this._schema.softDelete && !includeDeactivated
                  ? ' WHERE deactivated_at IS NULL'
                  : '';
              if ('$max' in val) {
                parts.push(
                  `${col} = (SELECT MAX(${col}) FROM ${this.schemaName}.${this.tableName}${softFilter})`
                );
              }
              if ('$min' in val) {
                parts.push(
                  `${col} = (SELECT MIN(${col}) FROM ${this.schemaName}.${this.tableName}${softFilter})`
                );
              }
              if ('$sum' in val) {
                parts.push(
                  `${col} = (SELECT SUM(${col}) FROM ${this.schemaName}.${this.tableName}${softFilter})`
                );
              }
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
   * Handles known pg errors and logs them. Never returns: every path throws
   * a translated {@link DatabaseError}.
   * @param err - The error thrown by pg-promise.
   * @throws {DatabaseError} Translated database error.
   */
  handleDbError(err: unknown): never {
    const e = err as Error & PgErrorLike & { stack?: string };
    if (this.logger?.error) {
      this.logger.error(
        `[DB ERROR] (${this._schema.dbSchema}.${this._schema.table})`,
        {
          message: e.message,
          code: e.code,
          detail: e.detail,
          stack: e.stack,
        }
      );
    }

    const message =
      e.code !== undefined && e.code in PG_ERROR_MESSAGES
        ? PG_ERROR_MESSAGES[e.code as PgErrorCode]
        : 'Database operation failed';
    throw new DatabaseError(message, e);
  }
}

export default QueryModel;
export { QueryModel };
