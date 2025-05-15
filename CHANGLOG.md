

# 📦 Changelog

All notable changes to **pg-schemata** will be documented in this file.

---

## [Unreleased]

### 🚀 Features
- Add support for `importFromSpreadsheet`, `bulkInsert`, and `bulkUpdate` with transactions
- Introduce `countAll`, `deleteWhere`, `updateWhere` methods to `TableModel` and `QueryModel`
- Support nested logical operators and `$`-prefixed condition keys in `buildCondition`
- Implement cursor-based pagination and enhanced WHERE clause logic
- Support Excel spreadsheet import via `exceljs`
- Add tenant-aware schema testing via `tenant_id` in test harness
- Enable automatic audit fields and default value handling
- Spreadsheet-driven testing and import using structured test files

### 🛠 Refactors
- Renamed `BaseModel` → `TableModel`; removed `ReadOnlyModel` for simplicity
- Modularized and enhanced code clarity in `QueryModel`, `TableModel`, and tests
- Unified schema structure and column handling logic
- Replaced custom `isPlainObject` with lodash implementation
- Rewrote test harness for tenant-awareness and reusable structure

### 🐛 Fixes
- Standardized handling of `$and`, `$or`, and condition operator normalization
- Fixed default value quoting and schema property access in DDL generation
- Improved integration test structure and database teardown logic

### 📚 Documentation
- Added best practices, design overview, and WHERE clause usage examples
- Improved JSDoc across DB, Model, and Schema utilities

Latest commit: `bbcfa57`

---

## [v0.1.0-beta.1] - 2025-04-17

Initial beta release with:

- Table and column schema definitions via JS object literals
- ColumnSet generation and pg-promise integration
- Base CRUD methods (`insert`, `update`, `delete`)
- DTO sanitization with optional audit fields
- Initial test suite and code documentation

Tagged commit: `v0.1.0-beta.1`