/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import QueryModel from './QueryModel.js';
import SchemaDefinitionError from './SchemaDefinitionError.js';
import { createTableSQL } from './utils/schemaBuilder.js';
import { readFileSync } from 'node:fs';
import { WorkbookReader } from '@nap-sft/tablsx';
import { isValidId, isPlainObject } from './utils/validation.js';
import { warnOnce } from './utils/deprecation.js';
import { logMessage } from './utils/pg-util.js';
import { generateZodFromTableSchema } from './utils/generateZodValidator.js';
import { getAuditActor } from './auditActorResolver.js';
import { auditEnabled, isAuditConfigObject } from './internalTypes.js';
import { ZodError } from 'zod';
import type { IMain, IResultExt, ITask } from 'pg-promise';
import type {
  DbConnection,
  Logger,
  Row,
  TableSchema,
  TableValidators,
} from './schemaTypes.js';
import type { QueryOptions, TxOption, WhereInput } from './queryTypes.js';

// Validators depend only on the schema definition, so they are built once
// per schema literal and shared by every rebuilt repository instance (N8).
// Keyed on the caller's raw schema object (not the normalized clone) on
// purpose: each model class closes over one schema literal.
const validatorCache = new WeakMap<TableSchema, TableValidators>();

/**
 * TableModel extends QueryModel to provide full read/write support for a PostgreSQL table.
 *
 * Adds create, update, and delete capabilities on top of the read-only features in QueryModel,
 * along with support for spreadsheet import/export, validation, and conditional mutations.
 *
 * ✅ Features:
 * - Full CRUD: `insert`, `update`, `delete`, `deleteWhere`, `updateWhere`
 * - Cursor-based and paginated queries via `findAfterCursor`
 * - Bulk operations: `bulkInsert`, `bulkUpdate`
 * - Data import/export: `importFromSpreadsheet`, `exportToSpreadsheet`
 * - Auto Zod schema validation and field sanitization
 *
 * This class is the standard entry point for interacting with a single table in pg-schemata.
 *
 * The row type defaults to `any` for backward compatibility; extend with an
 * explicit row interface (`class Users extends TableModel<UserRow>`) to get
 * typed CRUD results.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class TableModel<TRow = any> extends QueryModel<TRow> {
  /** Static fallback actor for audit fields, derived from the schema config. */
  private _auditUserDefault: string | null;

  /**
   * @deprecated Never assigned by the library; legacy instance-level
   * task/transaction honored by `_exec()` for backward compatibility.
   * Will be removed in 2.0.0 — pass the transaction per call via options.tx.
   */
  tx?: DbConnection | null;

  /**
   * Returns the deprecated instance-level tx, warning once when it is
   * actually used as the executor fallback.
   */
  private _instanceTx(): DbConnection | null {
    if (this.tx) {
      warnOnce(
        'tablemodel-tx',
        'Assigning model.tx is deprecated and will be removed in 2.0.0. Pass the transaction per call via options.tx instead.'
      );
    }
    return this.tx ?? null;
  }

  constructor(
    db: DbConnection,
    pgp: IMain,
    schema: TableSchema,
    logger: Logger | null = null
  ) {
    if (!schema.constraints?.primaryKey) {
      throw new SchemaDefinitionError(
        'Primary key must be defined in the schema'
      );
    }

    super(db, pgp, schema, logger);

    // Determine default value for audit user fields based on schema configuration
    // Use the schema's userFields.default if provided, otherwise fall back to null
    const auditConfig = this._schema.hasAuditFields;
    if (isAuditConfigObject(auditConfig) && auditConfig.enabled) {
      // Use explicit default from schema, or null if not specified.
      // The config value is typed `unknown`; audit actors are strings in
      // practice, matching the DDL varchar default.
      this._auditUserDefault = (auditConfig.userFields?.default ?? null) as
        string | null;
    } else if (auditConfig === true) {
      // Boolean format: use 'system' for backward compatibility
      this._auditUserDefault = 'system';
    } else {
      this._auditUserDefault = null;
    }

    // Auto-generate Zod validators if not provided. Cached per schema
    // literal: pg-promise's extend rebuilds every repository for each task
    // and transaction, and regenerating validators on each rebuild is the
    // bulk of that cost (N8). Each model class closes over one schema
    // object, so keying the WeakMap on it is safe.
    if (!this._schema.validators) {
      let validators = validatorCache.get(schema);
      if (!validators) {
        validators = generateZodFromTableSchema(this._schema);
        validatorCache.set(schema, validators);
      }
      this._schema.validators = validators;
    }
  }

  /**
   * Resolves the current audit actor.  Priority:
   * 1. auditActorResolver callback (if registered and returns non-null)
   * 2. _auditUserDefault (static fallback from schema config)
   *
   * @private
   */
  _resolveAuditActor(): string | null {
    return getAuditActor() ?? this._auditUserDefault;
  }

  /**
   * True when this table's schema enables audit fields. `hasAuditFields` may
   * be either a boolean or an object `{ enabled, userFields?, ... }`; this
   * helper normalizes both shapes so CRUD paths agree with addAuditFields()
   * and createColumnSet() (which both gate on === true / .enabled === true).
   *
   * @private
   */
  _auditEnabled(): boolean {
    return auditEnabled(this._schema.hasAuditFields);
  }

  /**
   * Resolves the executor for a mutating call. An explicit options.tx wins,
   * then the deprecated instance-level this.tx, then the base connection.
   * @param tx - pg-promise task/transaction context.
   * @returns Executor exposing one/any/none/result.
   */
  _exec(tx: DbConnection | null = null): DbConnection {
    return tx ?? this._instanceTx() ?? this.db;
  }

  /**
   * Validates a list of column names against the schema and escapes them.
   * Used for identifier lists (RETURNING, ON CONFLICT, DO UPDATE SET) that
   * would otherwise reach the SQL unescaped (issues 5, 6).
   * @param names - Column names to validate.
   * @returns Escaped identifiers.
   * @throws {SchemaDefinitionError} If a name is not a schema column.
   */
  _columns(names: string[]): string[] {
    if (!Array.isArray(names)) {
      throw new SchemaDefinitionError(
        `Expected an array of column names, got ${typeof names}`
      );
    }
    const valid = new Set(this._schema.columns.map(c => c.name));
    return names.map(n => {
      if (!valid.has(n)) {
        throw new SchemaDefinitionError(`Unknown column: ${n}`);
      }
      return this.escapeName(n);
    });
  }

  /**
   * Inserts a single row into the table after validation and sanitization.
   * @param dto - Data to insert.
   * @param options.tx - pg-promise task/transaction to run on.
   * @returns The inserted row.
   * @throws {SchemaDefinitionError} If validation fails or DTO is invalid.
   */
  async insert(dto: Partial<TRow> & Row, { tx }: TxOption = {}): Promise<TRow> {
    if (!isPlainObject(dto)) {
      return Promise.reject(
        new SchemaDefinitionError('DTO must be a non-empty object')
      );
    }
    // Zod validation if available
    try {
      if (this._schema.validators?.insertValidator) {
        this._schema.validators.insertValidator.parse(dto);
      }
    } catch (err) {
      const error = new SchemaDefinitionError('DTO validation failed');

      error.cause = err instanceof ZodError ? err.errors : err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error?.(`DTO validation failed: ${error.message}`, {
          cause: error.cause,
        });
      }

      // Return a rejected promise with the error
      return Promise.reject(error);
    }

    // Sanitize the DTO to include only valid columns
    const safeDto = this.sanitizeDto(dto);
    if (Object.keys(safeDto).length === 0) {
      return Promise.reject(
        new SchemaDefinitionError('DTO must contain at least one valid column')
      );
    }
    if (this._auditEnabled()) {
      if (!Object.prototype.hasOwnProperty.call(safeDto, 'created_by')) {
        safeDto.created_by = this._resolveAuditActor();
      }
      // Mirror created_by → updated_by on initial insert so both audit
      // columns are populated consistently. Matches the pattern upsert()
      // already follows. Callers can still override updated_by explicitly.
      if (!Object.prototype.hasOwnProperty.call(safeDto, 'updated_by')) {
        safeDto.updated_by = safeDto.created_by;
      }
    }
    let query;
    try {
      query = this.pgp.helpers.insert(safeDto, this.cs.insert) + ' RETURNING *';
    } catch (err) {
      const error = new Error('Failed to construct insert query');
      error.cause = err;
      return Promise.reject(error);
    }
    try {
      return await this._exec(tx).one<TRow>(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Deletes a record by its ID.
   * @param id - Primary key of the row to delete.
   * @param options.tx - pg-promise task/transaction to run on.
   * @returns Number of rows deleted.
   * @throws {Error} If the ID is invalid or deletion fails.
   */
  async delete(id: number | string, { tx }: TxOption = {}): Promise<number> {
    if (!isValidId(id)) {
      return Promise.reject(new Error('Invalid ID format'));
    }
    const softCheck = this._schema.softDelete
      ? ' AND deactivated_at IS NULL'
      : '';
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE id = $1${softCheck}`;
    try {
      return await this._exec(tx).result(query, [id], r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Updates a record by ID with new data.
   * @param id - Primary key value.
   * @param dto - Updated values.
   * @param options.tx - pg-promise task/transaction to run on.
   * @returns Updated record or null if not found.
   * @throws {SchemaDefinitionError} If ID or DTO is invalid.
   */
  async update(
    id: number | string,
    dto: Partial<TRow> & Row,
    { tx }: TxOption = {}
  ): Promise<TRow | null> {
    if (!isValidId(id)) {
      return Promise.reject(new SchemaDefinitionError('Invalid ID format'));
    }
    if (
      typeof dto !== 'object' ||
      Array.isArray(dto) ||
      Object.keys(dto).length === 0
    ) {
      return Promise.reject(
        new SchemaDefinitionError('DTO must be a non-empty object')
      );
    }
    try {
      if (this._schema.validators?.updateValidator) {
        this._schema.validators.updateValidator.parse(dto);
      }
    } catch (err) {
      const error = new SchemaDefinitionError('DTO validation failed');

      error.cause = err instanceof ZodError ? err.errors : err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error?.(`DTO validation failed: ${error.message}`, {
          cause: error.cause,
        });
      }

      // Return a rejected promise with the error
      return Promise.reject(error);
    }
    const safeDto = this.sanitizeDto(dto, { includeImmutable: false });
    if (
      this._auditEnabled() &&
      !Object.prototype.hasOwnProperty.call(safeDto, 'updated_by')
    ) {
      safeDto.updated_by = this._resolveAuditActor();
    }
    const softCheck = this._schema.softDelete
      ? ' AND deactivated_at IS NULL'
      : '';
    const condition = this.pgp.as.format('WHERE id = $1', [id]) + softCheck;
    const query =
      this.pgp.helpers.update(safeDto, this.cs.update, {
        schema: this.schema.dbSchema,
        table: this.schema.table,
      }) +
      ' ' +
      condition +
      ' RETURNING *';
    try {
      const result = await this._exec(tx).result(query, undefined, r => ({
        rowCount: r.rowCount,
        row: (r.rows?.[0] ?? null) as TRow | null,
      }));
      return result.rowCount ? result.row : null;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Inserts a record or updates it if it conflicts with specified columns.
   * @param dto - Data to insert or update.
   * @param conflictColumns - Columns that define the conflict constraint.
   * @param updateColumns - Columns to update on conflict. Defaults to all non-conflict columns.
   * @returns The inserted or updated row.
   */
  async upsert(
    dto: Partial<TRow> & Row,
    conflictColumns: string[],
    updateColumns: string[] | null = null,
    { tx }: TxOption = {}
  ): Promise<TRow> {
    if (!isPlainObject(dto)) {
      throw new SchemaDefinitionError('DTO must be a non-empty object');
    }
    if (!Array.isArray(conflictColumns) || conflictColumns.length === 0) {
      throw new SchemaDefinitionError(
        'Conflict columns must be a non-empty array'
      );
    }

    const safeDto = this.sanitizeDto(dto);
    if (this._auditEnabled()) {
      if (!Object.prototype.hasOwnProperty.call(safeDto, 'created_by')) {
        safeDto.created_by = this._resolveAuditActor();
      }
      if (!Object.prototype.hasOwnProperty.call(safeDto, 'updated_by')) {
        safeDto.updated_by = safeDto.created_by;
      }
    }

    const insertCs = new this.pgp.helpers.ColumnSet(Object.keys(safeDto), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const auditExclude = this._auditEnabled()
      ? ['created_at', 'created_by', 'updated_at', 'updated_by']
      : [];
    const columnsToUpdate = (
      updateColumns ||
      Object.keys(safeDto).filter(
        col => !conflictColumns.includes(col) && col !== 'id'
      )
    ).filter(col => !auditExclude.includes(col));

    const auditUpdate = this._auditEnabled()
      ? 'updated_at = NOW(), updated_by = EXCLUDED.updated_by'
      : '';
    const escapedUpdateCols = this._columns(columnsToUpdate);
    const setParts = [
      ...(escapedUpdateCols.length
        ? [escapedUpdateCols.map(col => `${col} = EXCLUDED.${col}`).join(', ')]
        : []),
      ...(auditUpdate ? [auditUpdate] : []),
    ];

    if (setParts.length === 0) {
      throw new SchemaDefinitionError(
        'No columns available for update on conflict'
      );
    }

    const query = `
      ${this.pgp.helpers.insert(safeDto, insertCs)}
      ON CONFLICT (${this._columns(conflictColumns).join(', ')})
      DO UPDATE SET ${setParts.join(', ')}
      RETURNING *
    `;

    try {
      return await this._exec(tx).one<TRow>(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Bulk upsert multiple records in a single transaction.
   * @param records - Array of records to upsert.
   * @param conflictColumns - Columns that define the conflict constraint.
   * @param updateColumns - Columns to update on conflict. Defaults to all non-conflict columns.
   * @param returning - Optional array of columns to return.
   * @returns Number of rows affected or array of rows if returning specified.
   */
  async bulkUpsert(
    records: (Partial<TRow> & Row)[],
    conflictColumns: string[],
    updateColumns: string[] | null,
    returning: [string, ...string[]],
    options?: TxOption
  ): Promise<Partial<TRow>[]>;
  async bulkUpsert(
    records: (Partial<TRow> & Row)[],
    conflictColumns: string[],
    updateColumns?: string[] | null,
    returning?: null,
    options?: TxOption
  ): Promise<number>;
  async bulkUpsert(
    records: (Partial<TRow> & Row)[],
    conflictColumns: string[],
    updateColumns?: string[] | null,
    returning?: string[] | null,
    options?: TxOption
  ): Promise<number | Partial<TRow>[]>;
  async bulkUpsert(
    records: (Partial<TRow> & Row)[],
    conflictColumns: string[],
    updateColumns: string[] | null = null,
    returning: string[] | null = null,
    { tx }: TxOption = {}
  ): Promise<number | Partial<TRow>[]> {
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }
    if (!Array.isArray(conflictColumns) || conflictColumns.length === 0) {
      throw new SchemaDefinitionError(
        'Conflict columns must be a non-empty array'
      );
    }
    if (returning !== null && !Array.isArray(returning)) {
      throw new SchemaDefinitionError(
        'Expected returning to be an array of column names'
      );
    }
    // An empty array means no RETURNING clause; leaving it truthy produced
    // invalid SQL and took the return-rows branch (PR #10 review).
    if (Array.isArray(returning) && returning.length === 0) {
      returning = null;
    }

    const safeRecords = records.map(dto => {
      const sanitized = this.sanitizeDto(dto);
      if (this._auditEnabled()) {
        if (!Object.prototype.hasOwnProperty.call(sanitized, 'created_by')) {
          sanitized.created_by = this._resolveAuditActor();
        }
        if (!Object.prototype.hasOwnProperty.call(sanitized, 'updated_by')) {
          sanitized.updated_by = sanitized.created_by;
        }
      }
      return sanitized;
    });

    const firstRecord = safeRecords[0];
    if (!firstRecord) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }

    const insertCs = new this.pgp.helpers.ColumnSet(Object.keys(firstRecord), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const auditExclude = this._auditEnabled()
      ? ['created_at', 'created_by', 'updated_at', 'updated_by']
      : [];
    const columnsToUpdate = (
      updateColumns ||
      Object.keys(firstRecord).filter(
        col => !conflictColumns.includes(col) && col !== 'id'
      )
    ).filter(col => !auditExclude.includes(col));

    const auditUpdate = this._auditEnabled()
      ? 'updated_at = NOW(), updated_by = EXCLUDED.updated_by'
      : '';
    const escapedUpdateCols = this._columns(columnsToUpdate);
    const setParts = [
      ...(escapedUpdateCols.length
        ? [escapedUpdateCols.map(col => `${col} = EXCLUDED.${col}`).join(', ')]
        : []),
      ...(auditUpdate ? [auditUpdate] : []),
    ];

    if (setParts.length === 0) {
      throw new SchemaDefinitionError(
        'No columns available for update on conflict'
      );
    }

    const returningClause = returning
      ? ` RETURNING ${this._columns(returning).join(', ')}`
      : '';

    const query = `
      ${this.pgp.helpers.insert(safeRecords, insertCs)}
      ON CONFLICT (${this._columns(conflictColumns).join(', ')})
      DO UPDATE SET ${setParts.join(', ')}
      ${returningClause}
    `;

    try {
      const exec = tx ?? this._instanceTx();
      if (exec) {
        if (returning) {
          return await exec.any(query);
        }
        return await exec.result(query, undefined, r => r.rowCount);
      }
      return await this.db.tx(async t => {
        if (returning) {
          return await t.any(query);
        }
        // undefined, not []: an empty array still runs the formatter over the
        // finished statement and throws on any $n token in the data (N5).
        return await t.result(query, undefined, r => r.rowCount);
      });
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🟤 Conditional Mutations
  // ---------------------------------------------------------------------------

  /**
   * Deletes rows matching a WHERE clause.
   * @param where - Filter criteria.
   * @returns Number of rows deleted.
   */
  async deleteWhere(where: WhereInput, { tx }: TxOption = {}): Promise<number> {
    const { clause, values } = this.buildWhereClause(where);
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    try {
      return await this._exec(tx).result(query, values, r => r.rowCount);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Updates only the updated_by timestamp for a given row.
   * @param id - Primary key.
   * @param updatedBy - User performing the update.
   * @returns Updated row.
   */
  async touch(
    id: number | string,
    updatedBy: string | null = null,
    { tx }: TxOption = {}
  ): Promise<TRow | null> {
    // Route through update(), which already applies soft delete check
    const effectiveUpdatedBy = updatedBy ?? this._resolveAuditActor();
    return this.update(
      id,
      (effectiveUpdatedBy
        ? { updated_by: effectiveUpdatedBy }
        : {}) as Partial<TRow> & Row,
      { tx }
    );
  }

  /**
   * Updates rows matching a WHERE clause.
   * @param where - Conditions.
   * @param updates - Fields to update.
   * @param options - Additional options (e.g., includeDeactivated).
   * @returns Number of rows updated.
   * @throws {SchemaDefinitionError} If input is invalid.
   */
  async updateWhere(
    where: WhereInput,
    updates: Partial<TRow> & Row,
    options: QueryOptions & TxOption = {}
  ): Promise<number> {
    const { includeDeactivated = false, tx = null } = options;

    const isNonEmpty = (val: unknown): boolean =>
      Array.isArray(val)
        ? val.length > 0
        : isPlainObject(val)
          ? Object.keys(val as object).length > 0
          : false;

    if (!isNonEmpty(where)) {
      throw new SchemaDefinitionError(
        'WHERE clause must be a non-empty object or non-empty array'
      );
    }

    if (!isNonEmpty(updates)) {
      throw new SchemaDefinitionError(
        'UPDATE payload must be a non-empty object'
      );
    }

    try {
      if (this._schema.validators?.updateValidator) {
        this._schema.validators.updateValidator.parse(updates);
      }
    } catch (err) {
      const error = new SchemaDefinitionError('DTO validation failed');

      error.cause = err instanceof ZodError ? err.errors : err;
      this.logger?.error?.(error);
      if (this.logger) {
        this.logger.error?.(`DTO validation failed: ${error.message}`, {
          cause: error.cause,
        });
      }

      // Return a rejected promise with the error
      return Promise.reject(error);
    }

    const safeUpdates = this.sanitizeDto(updates, { includeImmutable: false });

    if (
      this._auditEnabled() &&
      !Object.prototype.hasOwnProperty.call(safeUpdates, 'updated_by')
    ) {
      safeUpdates.updated_by = this._resolveAuditActor();
    }
    const updateCs = new this.pgp.helpers.ColumnSet(Object.keys(safeUpdates), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const setClause = this.pgp.helpers.update(safeUpdates, updateCs) as string;

    const { clause, values } = this.buildWhereClause(
      where,
      true,
      [],
      'AND',
      includeDeactivated
    );

    // The SET values are already inlined by helpers.update; format the WHERE
    // now and execute with no values so pg-promise never re-formats the
    // finished statement — a second pass would treat $n tokens inside stored
    // data as placeholders (issue N4).
    const query = `${setClause} WHERE ${this.pgp.as.format(clause, values)}`;
    try {
      const result = await this._exec(tx).result(
        query,
        undefined,
        r => r.rowCount
      );
      return result;
    } catch (err) {
      this.handleDbError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // 🔵 Bulk Operations
  // ---------------------------------------------------------------------------
  /**
   * Inserts many rows in a single batch operation, with optional RETURNING support.
   * @param records - Rows to insert.
   * @param returning - Optional array of columns to return.
   * @returns Number of rows inserted, or array of rows if returning specified.
   * @throws {SchemaDefinitionError} If records or returning are invalid.
   */
  async bulkInsert(
    records: (Partial<TRow> & Row)[],
    returning: [string, ...string[]],
    options?: TxOption
  ): Promise<Partial<TRow>[]>;
  async bulkInsert(
    records: (Partial<TRow> & Row)[],
    returning?: null,
    options?: TxOption
  ): Promise<number>;
  async bulkInsert(
    records: (Partial<TRow> & Row)[],
    returning?: string[] | null,
    options?: TxOption
  ): Promise<number | Partial<TRow>[]>;
  async bulkInsert(
    records: (Partial<TRow> & Row)[],
    returning: string[] | null = null,
    { tx: txOption = null }: TxOption = {}
  ): Promise<number | Partial<TRow>[]> {
    const tx = txOption ?? this._instanceTx();
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }

    if (returning !== null && !Array.isArray(returning)) {
      throw new SchemaDefinitionError(
        'Expected returning to be an array of column names'
      );
    }
    // An empty array means no RETURNING clause; leaving it truthy produced
    // invalid SQL and took the return-rows branch (PR #10 review).
    if (Array.isArray(returning) && returning.length === 0) {
      returning = null;
    }

    // Validate records
    if (this._schema.validators?.insertValidator) {
      this.validateDto(
        records,
        this._schema.validators.insertValidator,
        'Insert DTO'
      );
    }

    const safeRecords = records.map(dto => {
      const sanitized = this.sanitizeDto(dto);
      if (this._auditEnabled()) {
        if (!Object.prototype.hasOwnProperty.call(sanitized, 'created_by')) {
          sanitized.created_by = this._resolveAuditActor();
        }
        // Mirror created_by → updated_by on insert so both audit columns are
        // populated consistently (matches insert() and upsert()).
        if (!Object.prototype.hasOwnProperty.call(sanitized, 'updated_by')) {
          sanitized.updated_by = sanitized.created_by;
        }
      }
      return sanitized;
    });

    if (this._schema.softDelete) {
      for (const record of safeRecords) {
        if ('deactivated_at' in record) {
          throw new SchemaDefinitionError(
            'Cannot insert records with deactivated_at when softDelete is enabled'
          );
        }
      }
    }

    const firstRecord = safeRecords[0];
    if (!firstRecord) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }

    // The ColumnSet is built from the first record, so every record must
    // carry the same columns; fail with the offending index instead of an
    // opaque pg-promise error (suggestion 8).
    const expectedKeys = Object.keys(firstRecord).sort().join(', ');
    for (let i = 1; i < safeRecords.length; i++) {
      const keys = Object.keys(safeRecords[i] ?? {})
        .sort()
        .join(', ');
      if (keys !== expectedKeys) {
        throw new SchemaDefinitionError(
          `Record at index ${i} has columns [${keys}], but record 0 has [${expectedKeys}]`
        );
      }
    }

    const cs = new this.pgp.helpers.ColumnSet(Object.keys(firstRecord), {
      table: { table: this._schema.table, schema: this._schema.dbSchema },
    });

    const query =
      this.pgp.helpers.insert(safeRecords, cs) +
      (Array.isArray(returning) && returning.length > 0
        ? ` RETURNING ${this._columns(returning).join(', ')}`
        : '');

    try {
      // undefined, not []: an empty array still runs the formatter over the
      // finished statement and throws on any $n token in the data (N5).
      if (tx) {
        if (returning) {
          return await tx.any(query);
        }
        return await tx.result(query, undefined, r => r.rowCount);
      } else {
        return await this.db.tx(async t => {
          if (returning) {
            return await t.any(query);
          }
          return await t.result(query, undefined, r => r.rowCount);
        });
      }
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Updates multiple rows using their primary keys.
   * @param records - Each must include an ID field.
   * @param returning - Optional array of columns to return.
   * @returns Array of row counts or updated rows per query.
   * @throws {SchemaDefinitionError} If input or IDs are invalid.
   */
  async bulkUpdate(
    records: (Partial<TRow> & Row)[],
    returning: string[] | null = null,
    { tx: txOption = null }: TxOption = {}
  ): Promise<(number | Partial<TRow>[])[]> {
    const tx = txOption ?? this._instanceTx();
    const pk = this._schema.constraints?.primaryKey;
    if (!pk) {
      throw new SchemaDefinitionError(
        'Primary key must be defined in the schema'
      );
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new SchemaDefinitionError('Records must be a non-empty array');
    }

    if (returning !== null && !Array.isArray(returning)) {
      throw new SchemaDefinitionError(
        'Expected returning to be an array of column names'
      );
    }
    // An empty array means no RETURNING clause; leaving it truthy produced
    // invalid SQL and took the return-rows branch (PR #10 review).
    if (Array.isArray(returning) && returning.length === 0) {
      returning = null;
    }

    if (this._schema.validators?.updateValidator) {
      this.validateDto(
        records,
        this._schema.validators.updateValidator,
        'Update DTO'
      );
    }

    // Records sharing a key set reuse one ColumnSet instead of building one
    // per row.
    const columnSetsByKeys = new Map<string, unknown>();
    const queries = records.map(dto => {
      const id = dto.id;
      if (!isValidId(id)) {
        throw new SchemaDefinitionError(
          `Invalid ID in record: ${JSON.stringify(dto)}`
        );
      }
      const safeDto = this.sanitizeDto(dto, { includeImmutable: false });
      if (
        this._auditEnabled() &&
        !Object.prototype.hasOwnProperty.call(safeDto, 'updated_by')
      ) {
        safeDto.updated_by = this._resolveAuditActor();
      }
      delete safeDto.id;
      const softCheck = this._schema.softDelete
        ? ' AND deactivated_at IS NULL'
        : '';
      const condition = this.pgp.as.format('WHERE id = $1', [id]) + softCheck;
      const keys = Object.keys(safeDto);
      // Sort for the cache key only: key order varies between otherwise
      // identical DTOs, and pg-promise maps values by name, so one ColumnSet
      // serves any ordering of the same key set (PR #10 review).
      const cacheKey = [...keys].sort().join(',');
      let updateCs = columnSetsByKeys.get(cacheKey);
      if (!updateCs) {
        updateCs = new this.pgp.helpers.ColumnSet(keys, {
          table: { table: this._schema.table, schema: this._schema.dbSchema },
        });
        columnSetsByKeys.set(cacheKey, updateCs);
      }
      const returningClause = returning
        ? ` RETURNING ${this._columns(returning).join(', ')}`
        : '';
      return {
        query:
          this.pgp.helpers.update(
            safeDto,
            updateCs as InstanceType<IMain['helpers']['ColumnSet']>
          ) +
          ' ' +
          condition +
          returningClause,
      };
    });

    // Each query is fully formatted (the id is inlined in the WHERE); pass no
    // values so pg-promise does not run a second format pass over data that
    // may contain $n tokens (issue 14).
    try {
      const runBatch = (
        t: ITask<unknown>
      ): Promise<(number | Partial<TRow>[])[]> => {
        const jobs: Promise<number | Partial<TRow>[]>[] = queries.map(q =>
          returning
            ? t.any(q.query)
            : t.result(q.query, undefined, r => r.rowCount)
        );
        return t.batch(jobs);
      };
      if (tx) {
        return await runBatch(tx as ITask<unknown>);
      } else {
        return await this.db.tx(async t => runBatch(t));
      }
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Loads data from an Excel file and inserts it into the table.
   * Each row can be transformed using an optional callback before insertion.
   *
   * @param filePath - Source .xlsx file path.
   * @param sheetIndex - Sheet index to load.
   * @param callbackFn - Optional function (sync or async) to transform each row before insert.
   * @param returning - Optional array of columns to return from the insert.
   * @returns Number of rows inserted (or returned rows when `returning` is set).
   * @throws {SchemaDefinitionError} If file format is invalid or spreadsheet is empty.
   */
  async importFromSpreadsheet(
    filePath: string,
    sheetIndex = 0,
    callbackFn: ((row: Row) => Row | Promise<Row>) | null = null,
    returning: string[] | null = null,
    { tx }: TxOption = {}
  ): Promise<{ inserted: number | Partial<TRow>[] }> {
    if (typeof filePath !== 'string') {
      throw new SchemaDefinitionError('File path must be a valid string');
    }

    const buffer = readFileSync(filePath);
    const reader = WorkbookReader.fromBuffer(buffer);

    if (sheetIndex < 0 || sheetIndex >= reader.sheetCount) {
      throw new SchemaDefinitionError(
        `Sheet index ${sheetIndex} is out of bounds. Found ${reader.sheetCount} sheets.`
      );
    }

    const sheet = reader.sheet(sheetIndex);
    const rows: Row[] = [];
    let headers: string[] = [];

    for (let i = 0; i < sheet.rowCount; i++) {
      const cellRow = sheet.getRow(i);

      if (i === 0) {
        // Header cells become object keys; String() matches the implicit
        // key coercion the untyped code relied on.
        headers = cellRow.map(cell => String(cell.value));
        continue;
      }

      const obj: Row = {};
      headers.forEach((header, idx) => {
        obj[header] = cellRow[idx]?.value;
      });

      const transformed = callbackFn ? await callbackFn(obj) : obj;
      rows.push(transformed);
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new SchemaDefinitionError('Spreadsheet is empty or invalid format');
    }

    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: `Importing ${rows.length} records from spreadsheet`,
    });

    // If softDelete is enabled, strip deactivated_at from rows before bulkInsert
    if (this._schema.softDelete) {
      for (const row of rows) {
        delete row.deactivated_at;
      }
    }

    const inserted = await this.bulkInsert(
      rows as (Partial<TRow> & Row)[],
      returning,
      { tx }
    );

    return { inserted };
  }

  // ---------------------------------------------------------------------------
  // 🔻 Soft Delete Management
  // ---------------------------------------------------------------------------

  /**
   * Soft deletes records matching a WHERE clause by setting deactivated_at = NOW().
   * @param where - Filter criteria.
   * @returns Number of rows updated.
   */
  async removeWhere(where: WhereInput, { tx }: TxOption = {}): Promise<number> {
    if (!this._schema.softDelete) {
      const error: Error & { status?: number } = new Error(
        'Soft delete is not enabled for this table. Let the client decide if the record should be deleted instead.'
      );
      error.status = 403;
      return Promise.reject(error);
    }
    const { clause, values } = this.buildWhereClause(where);

    let setClause = 'deactivated_at = NOW()';
    if (this._auditEnabled()) {
      const actor = this._resolveAuditActor();
      if (actor != null) {
        values.push(actor);
        setClause += `, updated_by = $${values.length}, updated_at = NOW()`;
      }
    }

    const query = `UPDATE ${this.schemaName}.${this.tableName} SET ${setClause} WHERE ${clause}`;
    return this._exec(tx).result(query, values, r => r.rowCount);
  }

  /**
   * Restores previously soft-deleted records by setting deactivated_at = NULL.
   * @param where - Filter criteria.
   * @returns Number of rows updated.
   */
  async restoreWhere(
    where: WhereInput,
    { tx }: TxOption = {}
  ): Promise<number> {
    if (!this._schema.softDelete) {
      return Promise.reject(
        new Error('Soft delete is not enabled for this table.')
      );
    }
    const { clause, values } = this.buildWhereClause(
      where,
      true,
      [],
      'AND',
      true
    );

    let setClause = 'deactivated_at = NULL';
    if (this._auditEnabled()) {
      const actor = this._resolveAuditActor();
      if (actor != null) {
        values.push(actor);
        setClause += `, updated_by = $${values.length}, updated_at = NOW()`;
      }
    }

    const query = `UPDATE ${this.schemaName}.${this.tableName} SET ${setClause} WHERE ${clause}`;
    return this._exec(tx).result(query, values, r => r.rowCount);
  }

  /**
   * Permanently deletes soft-deleted records that match a given condition.
   * Useful for scheduled cleanup of records older than a threshold.
   * @param where - Filter conditions.
   * @returns pg-promise result.
   */
  async purgeSoftDeleteWhere(
    where: WhereInput = [],
    { tx }: TxOption = {}
  ): Promise<IResultExt> {
    if (!this._schema.softDelete) {
      return Promise.reject(
        new Error('Soft delete is not enabled for this table.')
      );
    }
    const normalized = Array.isArray(where) ? where : [where];
    const { clause, values } = this.buildWhereClause(
      [...normalized, { deactivated_at: { $not: null } }],
      true,
      [],
      'AND',
      true
    );
    const query = `DELETE FROM ${this.schemaName}.${this.tableName} WHERE ${clause}`;
    return this._exec(tx).result(query, values);
  }

  /**
   * Permanently deletes a soft-deleted row by ID.
   * @param id - Primary key value.
   * @returns pg-promise result.
   */
  async purgeSoftDeleteById(
    id: number | string,
    { tx }: TxOption = {}
  ): Promise<IResultExt> {
    if (!this._schema.softDelete) {
      return Promise.reject(
        new Error('Soft delete is not enabled for this table.')
      );
    }
    if (!isValidId(id)) throw new Error('Invalid ID format');
    return this.purgeSoftDeleteWhere([{ id }], { tx });
  }

  // ---------------------------------------------------------------------------
  // 🟣 Utilities
  // ---------------------------------------------------------------------------

  /**
   * Truncates the table and resets its identity sequence.
   */
  async truncate({ tx }: TxOption = {}): Promise<null> {
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: 'Truncating table',
    });
    const query = `TRUNCATE TABLE ${this.schemaName}.${this.tableName} RESTART IDENTITY CASCADE`;
    try {
      return await this._exec(tx).none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }

  /**
   * Creates the table using the current schema definition.
   * Automatically creates any indexes defined in the schema constraints.
   */
  async createTable({ tx }: TxOption = {}): Promise<null> {
    const hasIndexes = (this._schema.constraints?.indexes?.length ?? 0) > 0;
    logMessage({
      logger: this.logger,
      level: 'info',
      schema: this._schema.dbSchema,
      table: this._schema.table,
      message: hasIndexes
        ? 'Creating table with indexes from schema'
        : 'Creating table from schema',
    });
    try {
      const query = createTableSQL(this._schema, this.logger);
      return await this._exec(tx).none(query);
    } catch (err) {
      this.handleDbError(err);
    }
  }
}

export default TableModel;
export { TableModel };
