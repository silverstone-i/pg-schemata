# API Reference

This reference covers the public exports from [`src/index.js`](https://github.com/silverstone-i/pg-schemata/blob/main/src/index.js).

## Classes

- [DB](/reference/db) — Singleton database initialization
- [QueryModel](/reference/query-model) — Read-only query interface
- [TableModel](/reference/table-model) — Full CRUD operations (extends QueryModel)
- [MigrationManager](/reference/migration-manager) — Migration discovery and execution

## Types

- [Schema Types](/reference/schema-types) — TableSchema, ColumnDefinition, Constraints, and related interfaces

## Functions & Utilities

- [Utilities](/reference/utilities) — `callDb`, `bootstrap`, audit actor resolver functions

## Errors

- [Errors](/reference/errors) — `DatabaseError`, `SchemaDefinitionError`
