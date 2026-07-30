/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import type { z } from 'zod';
import type { IBaseProtocol, IMain } from 'pg-promise';

/**
 * Log levels understood by {@link Logger}.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Minimal structural logger interface (e.g. Winston, pino, console).
 * Every method is optional; missing levels are silently skipped.
 */
export interface Logger {
  debug?(message: string, meta?: unknown): void;
  info?(message: string, meta?: unknown): void;
  warn?(message: string, meta?: unknown): void;
  error?(message: string | Error, meta?: unknown): void;
}

/**
 * Any pg-promise executor: the root database, a task, or a transaction.
 */
export type DbConnection = IBaseProtocol<unknown>;

/** A database row as returned by pg-promise. */
export type Row = Record<string, unknown>;

/**
 * Synchronous callback returning the current actor ID (e.g. from
 * AsyncLocalStorage) for created_by / updated_by audit fields.
 */
export type AuditActorResolver = () => string | null;

/**
 * Context object pg-promise passes to `colProps.skip` / `colProps.init`.
 * See https://vitaly-t.github.io/pg-promise/helpers.Column.html
 */
export interface ColPropsContext {
  exists: boolean;
  value?: unknown;
  source?: unknown;
}

/**
 * Extended column behavior modifiers mapped onto pg-promise Column options.
 */
export interface ColProps {
  /** pg-promise format modifier (e.g. ':json'). */
  mod?: string;
  /** Conditionally skip this column in insert/update. */
  skip?: (col: ColPropsContext) => boolean;
  /** Use in conditional update clause. */
  cnd?: boolean;
  /** Function to initialize the value dynamically. */
  init?: (col: ColPropsContext) => unknown;
  /** Override default value (a JavaScript substitution value, not raw SQL). */
  def?: unknown;
  /** Custom Zod validator for this column. */
  validator?: z.ZodTypeAny;
}

/**
 * Defines the structure of a single column in a table schema.
 */
export interface ColumnDefinition {
  /** The name of the column. */
  name: string;
  /** PostgreSQL data type (e.g. 'text', 'uuid', 'integer', 'varchar(255)', 'jsonb'). */
  type: string;
  /** Marks the column as a generated column. */
  generated?: 'always' | 'by default';
  /** SQL expression used for the generated column. */
  expression?: string;
  /** Whether the generated column should be stored. */
  stored?: boolean;
  /** Whether the column is NOT NULL. Defaults to false. */
  notNull?: boolean;
  /**
   * @deprecated Legacy alias normalized onto `notNull` (`nullable: false` →
   * `notNull: true`) and removed from the schema. Will be dropped in 2.0.0.
   */
  nullable?: boolean;
  /** Default value for the column. Can be a literal or SQL expression. */
  default?: unknown;
  /** If true, the column cannot be updated after creation. Defaults to false. */
  immutable?: boolean;
  /** Extended column behavior modifiers. */
  colProps?: ColProps;
}

/**
 * Foreign key reference target. `schema` qualifies the target schema;
 * alternatively, `table` may be dotted (e.g. 'admin.foo'), which takes
 * precedence over `schema`.
 */
export interface ForeignKeyReference {
  table: string;
  columns: string[];
  schema?: string;
}

/**
 * Represents a schema-level constraint such as primary key or foreign key.
 */
export interface ConstraintDefinition {
  type: 'PrimaryKey' | 'ForeignKey' | 'Unique' | 'Check' | 'Index';
  /** List of column names the constraint applies to. */
  columns: string[];
  /** For foreign keys. */
  references?: ForeignKeyReference;
  /** Optional ON DELETE behavior (e.g. 'CASCADE'). */
  onDelete?: string;
  /** Optional ON UPDATE behavior (e.g. 'CASCADE'). */
  onUpdate?: string;
  /** SQL expression for check constraints. */
  expression?: string;
}

/**
 * Check constraint: only the SQL expression is read by the DDL generator.
 */
export interface CheckConstraintDefinition {
  /** Documented discriminator; not read by the SQL generator. */
  type?: 'Check';
  /** SQL expression enforcing the condition. */
  expression: string;
}

/**
 * Index columns may be plain column names, option objects, or raw
 * SQL expression strings.
 */
export type IndexColumn =
  string | { column: string; opclass?: string; order?: 'ASC' | 'DESC' };

/**
 * Index definition supporting the full CREATE INDEX option surface.
 */
export interface IndexDefinition {
  /** Documented discriminator; not read by the SQL generator. */
  type?: 'Index';
  columns: IndexColumn[];
  /** Custom index name. Auto-generated when omitted. */
  name?: string;
  unique?: boolean;
  /** Index method: btree, gin, gist, hash, spgist, brin. */
  using?: string;
  /** Partial index predicate (WHERE clause body). */
  where?: string;
  /** Storage parameters (WITH clause). */
  with?: Record<string, string | number>;
  tablespace?: string;
  /** Emit IF NOT EXISTS (default true); set false to disable. */
  ifNotExists?: boolean;
}

/**
 * Represents a unique constraint with optional modifiers (PostgreSQL 15+).
 */
export interface UniqueConstraintDefinition {
  /** List of column names the unique constraint applies to. */
  columns: string[];
  /** If true, NULL values are treated as equal for uniqueness (PostgreSQL 15+). */
  nullsNotDistinct?: boolean;
  /** Custom constraint name. Auto-generated when omitted. */
  name?: string;
}

/**
 * Container for all structural and relational constraints applied to a table.
 */
export interface Constraints {
  /** Column names used as the primary key. */
  primaryKey?: string[];
  /**
   * List of unique constraints. Supports both the simple format (array of
   * column names) and the object format with options.
   * Example simple: `[['email'], ['tenant_id', 'code']]`
   * Example with options: `[{ columns: ['email'], nullsNotDistinct: true }]`
   */
  unique?: (string[] | UniqueConstraintDefinition)[];
  /** Foreign key definitions. */
  foreignKeys?: ConstraintDefinition[];
  /** Check constraints; bare SQL expression strings are also accepted. */
  checks?: Array<CheckConstraintDefinition | string>;
  /** Index definitions for query optimization. */
  indexes?: IndexDefinition[];
}

/**
 * Configuration for audit fields when using object format.
 */
export interface AuditFieldsConfig {
  /** Whether to include audit fields. */
  enabled: boolean;
  /** Configuration for user tracking fields (created_by, updated_by). */
  userFields?: {
    /** PostgreSQL data type for user fields. Defaults to 'varchar(50)'. */
    type?: string;
    /** Whether user fields can be null. Defaults to true. */
    nullable?: boolean;
    /** Default value for user fields. Defaults to null. */
    default?: unknown;
  };
}

/**
 * Describes the full definition of a table schema for pg-schemata.
 */
export interface TableSchema {
  /** PostgreSQL schema name (e.g. 'public'). */
  dbSchema: string;
  /** @deprecated Legacy alias for `dbSchema`; the DDL generator falls back to it. */
  schemaName?: string;
  /** Table name. */
  table: string;
  /**
   * Whether to include created_at/updated_at/by fields. Accepts boolean for
   * backward compatibility or an object for configuration.
   */
  hasAuditFields?: boolean | AuditFieldsConfig;
  /** Whether to use a soft delete strategy (adds `deactivated_at`). */
  softDelete?: boolean;
  /** Optional schema version string. */
  version?: string;
  /** List of column definitions. */
  columns: ColumnDefinition[];
  /** Table-level constraints. */
  constraints?: Constraints;
  /** @deprecated Legacy top-level indexes; use `constraints.indexes`. */
  indexes?: IndexDefinition[];
}

/**
 * The Zod validators auto-generated from a table schema.
 */
export interface TableValidators {
  baseValidator: z.ZodTypeAny;
  insertValidator: z.ZodTypeAny;
  updateValidator: z.ZodTypeAny;
}

/**
 * Augmentable repository registry. Declare your repositories once and
 * `db()`, `DB.db`, and `callDb()` become fully typed:
 *
 * ```ts
 * declare module 'pg-schemata' {
 *   interface Repositories {
 *     users: Users;
 *     tenants: Tenants;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Repositories {}

/**
 * Constructor shape required of every repository passed to `DB.init`.
 */
export type RepositoryCtor<T = unknown> = new (
  db: DbConnection,
  pgp: IMain,
  logger?: Logger | null
) => T;
