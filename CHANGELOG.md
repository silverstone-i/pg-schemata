# 📦 Changelog

All notable changes to **pg-schemata** will be documented in this file.

---

Latest commit: `2f8f583`

---

## next version

### 🚀 Features

- Enhance `importFromSpreadsheet` to support row transformation via a `callbackFn`
- Add custom Zod validator support in `ColumnDefinition` via `colProps.validator`
- Improve Zod schema generation to respect custom validators
- Add support for generated columns in `createTableSQL` function
- Add support for $is and $not operator in query conditions
- Implement soft delete functionality across models with related methods
- Add Zod-based validation for `insert` and `update` DTOs in `TableModel`
- Add `countWhere` method to `QueryModel` for counting rows with specified conditions
- Enhance `generateZodFromTableSchema` to conditionally set optional enum fields in `insertValidator`
- Enhance `findAfterCursor` to support additional query options and include soft-deleted records
- Add option to include soft-deleted records in `findWhere` method
- Enhance `bulkInsert` and `bulkUpdate` to support optional `RETURNING` clause

### � Refactors

- Update count methods in `QueryModel` to use `countWhere` for consistency
- Remove unused `insert` and `exportToSpreadsheet` methods from `TableModel`
- Remove unused parameters from `TableModel` method documentation
- Refactor `exportToSpreadsheet` to directly assign rows from `findWhere`

### 🐛 Fixes

- Add `insert` method back to `TableModel`
- Simplify `bulkInsert` and `bulkUpdate` methods by removing unused options parameter
- Add optional options parameter to `bulkInsert` and `bulkUpdate` for transaction support
- Support optional `RETURNING` clause in `bulkInsert` and `bulkUpdate`
- Correct filtering issues in `countWhere`, `countAll`, and `findSoftDelete` methods
- Update soft delete tests to assert `deactivated_at IS NOT NULL` instead of `!=`
- Fix `$ne: null` condition handling in `QueryModel`
- Standardize `ColumnDefinition` by replacing deprecated `nullable` with `notNull`
- Remove unnecessary debug logging from `QueryModel`, `TableModel`, and `createTable` method
- Correct export for `TableSchema` to support TypeScript ambient context
- Correct file extension for `schemaTypes` in docs script
- Corrected type timestampz to correct postgres type timestamptz
- Standardized handling of `$and`, `$or`, and condition operator normalization
- Fixed default value quoting and schema property access in DDL generation
- Improved integration test structure and database teardown logic
- Streamline SQL generation by removing unnecessary line breaks and improving error messages
- Fix issue in `createTableSQL` to quote unquoted string default values

### 📚 Documentation

- Refactor and clarify schema types and JSDoc comments
- Document `validateDto` method in `TableModel` for DTO validation

### 🧪 Tests

- Add test for `CREATE TABLE` SQL with generated columns
- Add validation tests for `bulkInsert` and `bulkUpdate` methods
- Added unit tests for Zod schema generation
- Added integration tests for `updated_at` Zod coercion
- Adapted tests for updated `findWhere` behavior
- Add unit tests for `columnSetCache` in `schemaBuilder` (`aae5c68`)
- Clear columnSet cache and update schema properties in tests (`5b83d7e`)

### 🧹 Chores

- Remove duplicate entry for `schemaTypes.js` in coverage exclude list

### 📦 Dependencies

- Add `lru-cache` dependency to `package.json` (`500273a`)

---

## [v0.2.0-beta.1] - 2025-06-22

### 🚀 Features

- Implemented `callDb` with schema-aware access to db methods
- Added `exportToSpreadsheet` method to TableModel
- Added Zod validation support to TableModel and schema generator
- Added ZodError handling to TableModel
- Enhanced DB initialization with optional logger and improved logging format
- Enhanced `findWhere` to support aggregation functions (MAX, MIN, SUM)
- Exported `db` and `pgp` from index for external usage
- Implement `logMessage` utility for consistent logging across QueryModel and TableModel (`9ef603f`)
- Introduce `DatabaseError` and `SchemaDefinitionError` classes for better error handling (`660d3ac`)
- Add `setSchemaName` method and improve error handling in `QueryModel` (`e55760d`)
- Implement LRU caching for `ColumnSet` creation to improve performance in `schemaBuilder` (`9e4020e`)
- Add support for `importFromSpreadsheet`, `bulkInsert`, and `bulkUpdate` with transactions
- Introduce `countAll`, `deleteWhere`, `updateWhere` methods to `TableModel` and `QueryModel`
- Support nested logical operators and `$`-prefixed condition keys in `buildCondition`
- Implement cursor-based pagination and enhanced WHERE clause logic
- Support Excel spreadsheet import via `exceljs`
- Add tenant-aware schema testing via `tenant_id` in test harness
- Enable automatic audit fields and default value handling
- Spreadsheet-driven testing and import using structured test files

### 🛠 Refactors

- Improved logging format in QueryModel
- Removed `attachToCallDb` and related tests
- Streamlined index exports
- Refactored `findAll` and `findById` to reuse `findWhere`
- Added column property validation in schemaBuilder
- Consolidated and replaced lodash usage
- Migrated from Jest to Vitest with cleaner test output
- Enhance `logQuery` to include parameters and improve error logging format (`5d08f35`)
- Rename `schema` to `dbSchema` in `schemaBuilder` for consistency (`c7dcd40`)
- Remove internal error handling method from `TableModel` to streamline code (`dd40395`)
- Remove debug logging and standardize property names in `schemaBuilder` (`fb99d36`)
- Renamed `BaseModel` → `TableModel`; removed `ReadOnlyModel` for simplicity
- Modularized and enhanced code clarity in `QueryModel`, `TableModel`, and tests
- Unified schema structure and column handling logic
- Replaced custom `isPlainObject` with lodash implementation
- Rewrote test harness for tenant-awareness and reusable structure

### 🐛 Fixes

- Fixed date coercion bug in Zod validation
- Improved default value handling in `createTableSQL`

### 🧪 Tests

- Added unit tests for Zod schema generation
- Added integration tests for `updated_at` Zod coercion
- Adapted tests for updated `findWhere` behavior
- Add unit tests for `columnSetCache` in `schemaBuilder` (`aae5c68`)
- Clear columnSet cache and update schema properties in tests (`5b83d7e`)

### 📦 Dependencies

- Add `lru-cache` dependency to `package.json` (`500273a`)

### 🐛 Fixes

- Standardized handling of `$and`, `$or`, and condition operator normalization
- Fixed default value quoting and schema property access in DDL generation
- Improved integration test structure and database teardown logic

### 📚 Documentation

- Merged docs branch (squashed)
- Update README with enhanced features and spreadsheet import support (`ee4a01a`)
- Added best practices, design overview, and WHERE clause usage examples
- Improved JSDoc across DB, Model, and Schema utilities

---

## [v0.1.0-beta.1] - 2025-04-17

Initial beta release with:

- Table and column schema definitions via JS object literals
- ColumnSet generation and pg-promise integration
- Base CRUD methods (`insert`, `update`, `delete`)
- DTO sanitization with optional audit fields
- Initial test suite and code documentation

Tagged commit: `v0.1.0-beta.1`
