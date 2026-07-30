/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

/**
 * Internal types and type guards. Not exported from the package barrel.
 */

import type { ColumnSet } from 'pg-promise';
import type {
  AuditFieldsConfig,
  TableSchema,
  TableValidators,
  UniqueConstraintDefinition,
} from './schemaTypes.js';

/**
 * The schema after QueryModel's constructor clones and normalizes the
 * caller's input: the `nullable` alias is stripped, audit and soft-delete
 * columns are appended, and TableModel lazily attaches validators. A
 * superset of the public {@link TableSchema}.
 */
export interface NormalizedTableSchema extends TableSchema {
  validators?: TableValidators;
}

/**
 * The ColumnSet bundle built by createColumnSet: fixed insert/update
 * variants plus one entry keyed by the table name.
 */
export interface TableColumnSets {
  insert: ColumnSet<unknown>;
  update: ColumnSet<unknown>;
  [tableName: string]: ColumnSet<unknown>;
}

/** Narrows `hasAuditFields` to its object configuration form. */
export function isAuditConfigObject(
  value: TableSchema['hasAuditFields']
): value is AuditFieldsConfig {
  return typeof value === 'object' && value !== null;
}

/** True when the schema's `hasAuditFields` setting enables audit fields. */
export function auditEnabled(value: TableSchema['hasAuditFields']): boolean {
  return (
    value === true || (isAuditConfigObject(value) && value.enabled === true)
  );
}

/** Narrows a `unique` entry to its object form. */
export function isUniqueConstraintObject(
  value: string[] | UniqueConstraintDefinition
): value is UniqueConstraintDefinition {
  return !Array.isArray(value);
}
