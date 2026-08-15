/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// Distilled from a real downstream consumer (26 models, 313 column
// definitions) that could not construct a single model on 2.0.0. These are
// deliberately *not* a vendored copy of those models: a copy drifts the
// moment the consumer edits a model, and it tests the consumer rather than
// the library. What is reproduced here is the shape — every distinct type
// string in use, and every constraint and index form — with the real
// declarations rather than idealized ones.

import type { TableSchema } from '../../src/schemaTypes.js';

/**
 * One column per distinct type string the consumer uses.
 *
 * `time`, `text[]` and `uuid[]` are the three that threw on 2.0.0, and
 * because validators are generated eagerly in the TableModel constructor
 * that was a hard failure at app boot. Both `int` and `integer` appear in
 * real schemas, so both are here.
 */
export const typesCoverageSchema: TableSchema = {
  dbSchema: 'consumer_cov',
  table: 'types_coverage',
  hasAuditFields: {
    enabled: true,
    userFields: { type: 'uuid', nullable: true, default: null },
  },
  softDelete: false,
  columns: [
    {
      name: 'id',
      type: 'uuid',
      notNull: true,
      default: 'gen_random_uuid()',
      immutable: true,
      colProps: { cnd: true },
    },
    { name: 'title', type: 'text', notNull: true },
    { name: 'small_count', type: 'int' },
    { name: 'big_count', type: 'integer' },
    { name: 'amount', type: 'numeric' },
    { name: 'payload', type: 'jsonb', colProps: { mod: ':json' } },
    { name: 'is_active', type: 'boolean', notNull: true, default: true },
    { name: 'rank', type: 'smallint' },
    { name: 'occurred_at', type: 'timestamptz' },
    { name: 'occurred_on', type: 'date' },
    { name: 'starts_at', type: 'time' },
    { name: 'tags', type: 'text[]', default: "'{}'" },
    {
      name: 'related_ids',
      type: 'uuid[]',
      default: "'{}'::uuid[]",
      // pg-promise renders a JS array as a text[] literal, which PostgreSQL
      // will not implicitly cast to uuid[].
      colProps: { cast: 'uuid[]' },
    },
    { name: 'code', type: 'varchar(10)' },
    { name: 'sequence_no', type: 'bigint' },
  ],
  constraints: {
    primaryKey: ['id'],
  },
};

/**
 * The constraint and index shapes the consumer relies on, including the
 * partial-unique indexes whose silent loss motivated the top-level `indexes`
 * rejection.
 */
export const constraintCoverageSchema: TableSchema = {
  dbSchema: 'consumer_cov',
  table: 'constraint_coverage',
  hasAuditFields: false,
  softDelete: false,
  columns: [
    { name: 'tenant_id', type: 'uuid', notNull: true },
    { name: 'entity_id', type: 'uuid', notNull: true },
    { name: 'kind', type: 'varchar(20)', notNull: true },
    { name: 'parent_id', type: 'uuid' },
    { name: 'owner_id', type: 'uuid' },
    { name: 'category_id', type: 'uuid' },
    { name: 'label', type: 'text' },
    { name: 'status', type: 'text', notNull: true, default: "'draft'" },
    { name: 'is_primary', type: 'boolean', notNull: true, default: false },
  ],
  constraints: {
    // Composite key, no surrogate id.
    primaryKey: ['tenant_id', 'entity_id', 'kind'],
    foreignKeys: [
      {
        type: 'ForeignKey',
        columns: ['parent_id'],
        references: { table: 'types_coverage', columns: ['id'] },
        onDelete: 'CASCADE',
      },
      {
        type: 'ForeignKey',
        columns: ['owner_id'],
        references: { table: 'types_coverage', columns: ['id'] },
        onDelete: 'SET NULL',
      },
      {
        type: 'ForeignKey',
        columns: ['category_id'],
        references: { table: 'types_coverage', columns: ['id'] },
        onDelete: 'RESTRICT',
      },
    ],
    // Both accepted forms in the same array.
    unique: [
      ['tenant_id', 'label'],
      { columns: ['tenant_id', 'owner_id'], nullsNotDistinct: true },
    ],
    checks: [
      // Contains a cast, so the check parser meets real SQL rather than only
      // the two shapes it understands. (`<@` would need an array on the left;
      // `status` is text, so this is the ANY form.)
      {
        expression: "status = ANY(ARRAY['draft','live','archived']::text[])",
      },
      { expression: 'char_length(kind) > 1' },
    ],
    indexes: [
      { columns: ['kind'] },
      { columns: ['tenant_id', 'entity_id'], unique: true },
      {
        columns: ['tenant_id'],
        unique: true,
        where: 'is_primary',
      },
    ],
  },
};
