/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import SchemaDefinitionError from '../SchemaDefinitionError.js';

/**
 * @private
 *
 * Identifiers that need no quoting in PostgreSQL: a letter or underscore
 * followed by letters, digits, underscores, or dollar signs.
 *
 * Deliberately narrower than what PostgreSQL accepts inside double quotes,
 * which is very nearly anything. The PRD documents snake_case for every table,
 * column, and schema name, so nothing legitimate is excluded — while a name
 * carrying a quote, semicolon, or comment marker is rejected before it can
 * reach a DDL string.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** PostgreSQL truncates identifiers past NAMEDATALEN - 1 = 63 bytes. */
const MAX_IDENTIFIER_BYTES = 63;

/**
 * @private
 *
 * Rejects an identifier that cannot safely be interpolated into generated SQL.
 *
 * The query paths run every identifier through `pgp.as.name()`, but DDL
 * generation builds its statements as strings and has no pg-promise instance to
 * call. A schema name such as `tenant"; DROP TABLE customers; --` therefore
 * closed the quoting in `CREATE SCHEMA "..."` and appended a second statement
 * that ran during bootstrap or a migration. Schema names in particular are
 * frequently request-derived in schema-per-tenant deployments, which is exactly
 * the untrusted path.
 *
 * Validating here rather than escaping at each of the fourteen interpolation
 * sites means a new site cannot silently miss the escaping — and it also
 * rejects the truncation hazard, where two schemas differing past byte 63
 * collapse onto one after PostgreSQL truncates them.
 *
 * @param name - The candidate identifier.
 * @param label - What the identifier names, used in the error message.
 * @returns The identifier, unchanged, so call sites can inline it.
 * @throws {SchemaDefinitionError} If the identifier is unusable.
 */
export function assertValidIdentifier(name: unknown, label: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new SchemaDefinitionError(
      `${label} must be a non-empty string, got ${
        typeof name === 'string' ? 'an empty string' : typeof name
      }`
    );
  }
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new SchemaDefinitionError(
      `${label} "${name}" is not a valid SQL identifier: expected a letter or underscore followed by letters, digits, underscores, or dollar signs`
    );
  }
  if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES) {
    throw new SchemaDefinitionError(
      `${label} "${name}" exceeds PostgreSQL's ${MAX_IDENTIFIER_BYTES}-byte identifier limit and would be silently truncated`
    );
  }
  return name;
}

/**
 * @private
 *
 * Rejects a WHERE-clause joiner that is not `AND` or `OR`.
 *
 * `JoinType` is a compile-time union and erases at runtime, while the value is
 * interpolated between predicates as raw SQL. Every public query method
 * forwards it straight from its caller, so a JavaScript consumer — or a
 * TypeScript one holding a widened `string` — could terminate the statement and
 * append another.
 *
 * Case is not normalized. Lowercase `and`/`or` were removed in 2.0.0 and throw
 * rather than being silently accepted, which is the existing contract.
 *
 * @param joiner - The candidate joiner.
 * @throws {SchemaDefinitionError} If the joiner is not exactly 'AND' or 'OR'.
 */
export function assertJoinType(joiner: unknown): void {
  if (joiner !== 'AND' && joiner !== 'OR') {
    throw new SchemaDefinitionError(
      `Join type must be 'AND' or 'OR', got ${JSON.stringify(joiner)}`
    );
  }
}

/**
 * @private
 *
 * Validates every identifier a schema contributes to generated DDL.
 *
 * Constraint and index names are included: they are interpolated the same way,
 * and a caller-supplied `name` on a unique constraint or index is as reachable
 * as the table name.
 *
 * Not validated here: `expression`, `where`, `checks[].expression`, `using`,
 * and column `type`/`default`. Those are documented as raw SQL emitted as
 * written — see docs/guide/schema-definition.md — and a caller putting
 * untrusted input in them is writing SQL directly, which no identifier check
 * can address.
 *
 * @param schema - Table schema whose identifiers to check.
 * @throws {SchemaDefinitionError} On the first unusable identifier.
 */
export function assertSchemaIdentifiers(schema: {
  dbSchema?: string;
  table?: string;
  columns?: { name?: string }[];
  constraints?: {
    primaryKey?: string[];
    unique?: (string[] | { columns?: string[]; name?: string })[];
    foreignKeys?: {
      columns?: string[];
      references?: { table?: string; schema?: string; columns?: string[] };
    }[];
    indexes?: { columns?: unknown[]; name?: string }[];
  };
}): void {
  if (typeof schema.dbSchema !== 'undefined') {
    assertValidIdentifier(schema.dbSchema, 'Schema name');
  }
  assertValidIdentifier(schema.table, 'Table name');

  for (const col of schema.columns ?? []) {
    assertValidIdentifier(col?.name, 'Column name');
  }

  const constraints = schema.constraints ?? {};

  for (const col of constraints.primaryKey ?? []) {
    assertValidIdentifier(col, 'Primary key column');
  }

  for (const entry of constraints.unique ?? []) {
    const cols = Array.isArray(entry) ? entry : (entry?.columns ?? []);
    for (const col of cols) {
      assertValidIdentifier(col, 'Unique constraint column');
    }
    if (!Array.isArray(entry) && entry?.name) {
      assertValidIdentifier(entry.name, 'Unique constraint name');
    }
  }

  for (const fk of constraints.foreignKeys ?? []) {
    for (const col of fk?.columns ?? []) {
      assertValidIdentifier(col, 'Foreign key column');
    }
    // A malformed `references` is left to createTableSQL, whose errors name the
    // owning table and the expected shape. Reporting "not a valid identifier"
    // first would replace a better diagnostic with a worse one.
    const ref = fk?.references;
    if (typeof ref !== 'object' || ref === null) continue;

    const table = ref.table;
    if (typeof table === 'string' && table.includes('.')) {
      // The dotted '<schema>.<table>' form is split before interpolation, so
      // each half is checked rather than the whole string. A malformed split is
      // likewise createTableSQL's to report.
      const dot = table.indexOf('.');
      const left = table.slice(0, dot);
      const right = table.slice(dot + 1);
      if (!left || !right || right.includes('.')) continue;
      assertValidIdentifier(left, 'Foreign key schema');
      assertValidIdentifier(right, 'Foreign key table');
    } else if (typeof table !== 'string') {
      continue;
    } else {
      assertValidIdentifier(table, 'Foreign key table');
    }

    if (typeof ref.schema !== 'undefined') {
      assertValidIdentifier(ref.schema, 'Foreign key schema');
    }
    for (const col of ref.columns ?? []) {
      assertValidIdentifier(col, 'Foreign key referenced column');
    }
  }

  for (const index of constraints.indexes ?? []) {
    if (index?.name) {
      assertValidIdentifier(index.name, 'Index name');
    }
    for (const col of index?.columns ?? []) {
      if (col && typeof col === 'object' && 'expression' in col) {
        if (typeof col.expression !== 'string' || !col.expression.trim()) {
          throw new SchemaDefinitionError(
            'Index expression must be a non-empty trusted SQL string'
          );
        }
        if ('column' in col)
          throw new SchemaDefinitionError(
            'Index column cannot combine an identifier and expression'
          );
        if (!index.name)
          throw new SchemaDefinitionError(
            'Expression indexes require an explicit index name'
          );
        continue;
      }
      // Identifier inputs retain the strict guard; SQL requires the explicit expression field.
      const columnName =
        typeof col === 'string'
          ? col
          : (col as { column?: string } | null)?.column;
      assertValidIdentifier(columnName, 'Index column');
    }
  }
}
