/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import type { DbConnection } from './schemaTypes.js';

/**
 * Field-level operators supported inside WHERE condition objects.
 * See the where-modifiers reference in the docs for full semantics.
 */
export const CONDITION_OPERATORS = [
  '$like',
  '$ilike',
  '$from',
  '$to',
  '$in',
  '$eq',
  '$ne',
  '$max',
  '$min',
  '$sum',
  '$not',
  '$is',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Scalar values accepted as SQL parameters in conditions. */
export type Scalar = string | number | boolean | Date | null;

/**
 * Operator-keyed condition on a single column. Multiple operator keys are
 * allowed on one object; each emits its own SQL clause.
 */
export interface OperatorCondition {
  $like?: string;
  $ilike?: string;
  $from?: Scalar;
  $to?: Scalar;
  /** Must be a non-empty array. */
  $in?: Scalar[];
  $eq?: Scalar;
  /** `null` emits IS NOT NULL. */
  $ne?: Scalar;
  /** Only `null` is supported (emits IS NOT NULL). */
  $not?: null;
  /** Only `null` is supported (emits IS NULL). */
  $is?: null;
  /** Presence-only flag: matches rows where the column equals MAX(column). */
  $max?: unknown;
  /** Presence-only flag: matches rows where the column equals MIN(column). */
  $min?: unknown;
  /** Presence-only flag: matches rows where the column equals SUM(column). */
  $sum?: unknown;
}

/**
 * Column-keyed conditions: each key is a column name mapped to a scalar
 * (equality / IS NULL) or an {@link OperatorCondition}.
 */
export type FieldConditions = Record<
  string,
  Scalar | OperatorCondition | undefined
>;

/**
 * A single WHERE condition node: nested boolean logic via `$and` / `$or`
 * (or the deprecated lowercase aliases), or column-keyed conditions.
 */
export type WhereCondition =
  | { $and: WhereCondition[] }
  | { $or: WhereCondition[] }
  /** @deprecated Use `$and`. */
  | { and: WhereCondition[] }
  /** @deprecated Use `$or`. */
  | { or: WhereCondition[] }
  | FieldConditions;

/** Conditions in either shape accepted by the public query methods. */
export type WhereInput = WhereCondition | WhereCondition[];

/**
 * The `filters` option: column-keyed conditions plus optional top-level
 * boolean groups (`$and`/`$or`, or the legacy lowercase `and`/`or` special
 * cased by findAfterCursor).
 */
export interface FiltersInput {
  $and?: WhereCondition[];
  $or?: WhereCondition[];
  /** @deprecated Use `$and`. */
  and?: WhereCondition[];
  /** @deprecated Use `$or`. */
  or?: WhereCondition[];
  [column: string]: Scalar | OperatorCondition | WhereCondition[] | undefined;
}

/** Logical joiner between conditions. */
export type JoinType = 'AND' | 'OR';

/** Options common to all read queries. */
export interface QueryOptions {
  /** Include soft-deleted records when true. */
  includeDeactivated?: boolean;
}

/** Options accepted by findWhere / findOneBy and friends. */
export interface FindOptions extends QueryOptions {
  /** Columns to return; all columns when omitted. */
  columnWhitelist?: string[] | null;
  /** Additional filter object. */
  filters?: FiltersInput;
  /** Sort columns. */
  orderBy?: string | string[] | null;
  /** Limit results. Numeric strings are accepted and validated. */
  limit?: number | string | null;
  /** Offset results. Numeric strings are accepted and validated. */
  offset?: number | string | null;
}

/** Options accepted by findAfterCursor. */
export interface CursorOptions extends QueryOptions {
  descending?: boolean;
  columnWhitelist?: string[] | null;
  filters?: FiltersInput;
}

/** Result page returned by findAfterCursor. */
export interface CursorPage<TRow> {
  rows: TRow[];
  nextCursor: Record<string, unknown> | null;
}

/** Option bag for mutating calls that may run inside a task/transaction. */
export interface TxOption {
  /** pg-promise task/transaction to run on. */
  tx?: DbConnection | null;
}

/** Clause and accumulated parameter values built by buildWhereClause. */
export interface WhereClauseResult {
  clause: string;
  values: unknown[];
}

/**
 * Messages for the PostgreSQL error codes translated by handleDbError.
 */
export const PG_ERROR_MESSAGES = {
  '23505': 'Unique constraint violation',
  '23503': 'Foreign key constraint violation',
  '23514': 'Check constraint violation',
  '22P02': 'Invalid input syntax for type',
} as const;

export type PgErrorCode = keyof typeof PG_ERROR_MESSAGES;
