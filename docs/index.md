---
layout: home

hero:
  name: "pg-schemata"
  text: "PostgreSQL-first ORM for Node.js"
  tagline: Define your schema once. Get CRUD, migrations, validation, and multi-tenancy — all built on pg-promise.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /reference/

features:
  - title: Schema-driven
    details: Define tables, columns, constraints, and behavior in a single JavaScript object. pg-schemata generates DDL, ColumnSets, and Zod validators from it.
  - title: Full CRUD + bulk ops
    details: insert, update, delete, upsert, bulkInsert, bulkUpdate, bulkUpsert — all with automatic validation, audit fields, and soft delete awareness.
  - title: Flexible WHERE builder
    details: Query with $like, $in, $from/$to, $and/$or, and more. Compose conditions as plain objects — no query DSL to learn.
  - title: Cursor pagination
    details: Keyset-based pagination via findAfterCursor with multi-column cursor support, ascending and descending order.
  - title: Soft delete
    details: Enable per-table soft delete with a single flag. All queries automatically exclude deactivated rows unless you opt in.
  - title: Migrations
    details: MigrationManager discovers, applies, and tracks versioned migration scripts with SHA-256 integrity verification and advisory locking.
  - title: Multi-schema tenancy
    details: Switch PostgreSQL schemas at runtime with callDb or setSchemaName for per-tenant data isolation.
  - title: Audit fields
    details: Automatic created_at, updated_at, created_by, updated_by tracking with a pluggable actor resolver for dynamic user injection.
---

## Why pg-schemata

`pg-schemata` is designed for Node.js applications that use PostgreSQL directly and want structured table access without a heavy ORM. You define your schema as a JavaScript object, extend `TableModel`, and get a fully featured repository with validation, audit trails, and safe query building — all backed by `pg-promise`.

## Documentation map

- Start with [Getting Started](/guide/getting-started) for installation and your first model.
- Read [Schema Definition](/guide/schema-definition) to understand the schema object.
- See [Models](/guide/models) for QueryModel vs TableModel and extending them.
- Use [CRUD Operations](/guide/crud-operations) for day-to-day insert, update, delete, and bulk ops.
- See [WHERE Modifiers](/guide/where-modifiers) for the full query operator reference.
- Browse the [API Reference](/reference/) for method signatures and parameters.
