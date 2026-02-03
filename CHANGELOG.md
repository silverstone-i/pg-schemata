# 📦 Changelog

All notable changes to **pg-schemata** will be documented in this file.

---

Latest commit: `c22c921`

---

## [v1.2.3] - 2026-02-02

### 🐛 Fixes

- **Excel Import Path Fix**: Correct `xlsxjs` import to `@nap-sft/xlsxjs` in `QueryModel.exportToSpreadsheet` method, which was missed during v1.2.2 migration

### 📝 Docs

- **Release Guide Updates**: Modernize Git commands from `git checkout` to `git switch` and add PR workflow options throughout the guide

---

## [v1.2.2] - 2026-02-02

### 🛠 Refactors

- **Excel Library Migration**: Replace `exceljs` with `@nap-sft/xlsxjs` for spreadsheet import/export functionality (`07dc564`)
  - Updated import statements in `TableModel.js`
  - Updated test mocks to use the new package name
  - Migrated from `exceljs` to `@nap-sft/xlsxjs` to address dependency concerns with outdated transitive dependencies.

---

## [v1.2.1] - 2026-01-29

### 🚀 Features

- **UNIQUE NULLS NOT DISTINCT Support**: Add PostgreSQL 15+ `NULLS NOT DISTINCT` modifier for unique constraints
  - Treats NULL values as equal for uniqueness purposes (standard behavior treats NULLs as always distinct)
  - Supports both simple array format and new object format for unique constraints
  - New format: `unique: [{ columns: ['tenant_id', 'email'], nullsNotDistinct: true, name: 'custom_name' }]`
  - Optional custom constraint naming via `name` property
  - TypeScript types updated with new `UniqueConstraintDefinition` interface
  - Full backward compatibility with existing array-only format

### 🐛 Fixes

- **Function Call Prefix**: Remove automatic `public.` schema prefix from function calls in default values, allowing PostgreSQL to resolve functions via `search_path`
- **Integration Tests**: Fix error-swallowing try/catch blocks in integration tests that masked actual test failures

### 🧪 Tests

- Add 5 new test cases for `NULLS NOT DISTINCT` covering object format, custom names, mixed formats, and edge cases
- All 250 tests passing

---

## [v1.2.0] - 2026-01-28

### 🚀 Features

- **Configurable Audit Fields**: Add support for object format in `hasAuditFields` to customize user tracking field types
  - Supports configurable PostgreSQL types for `created_by` and `updated_by` columns (e.g., `uuid`, `int`, `varchar`)
  - Maintains full backward compatibility with existing boolean format
  - New format: `hasAuditFields: { enabled: true, userFields: { type: 'uuid', nullable: true, default: null } }`
  - TypeScript types updated with new `AuditFieldsConfig` interface

### 📚 Documentation

- Add comprehensive documentation for new `hasAuditFields` object format in README, getting started guide, and schema types docs
- Add examples demonstrating UUID, integer, and custom type configurations for audit fields

### 🧪 Tests

- Add 11 new test cases for `hasAuditFields` covering object format, backward compatibility, and edge cases
- All 37 `schemaBuilder` tests passing

---

## [v1.1.1] - 2025-09-26

Schema builder now emits clearer logging and supports index generation across schemas, including new coverage for customers.

### 🚀 Features

- Enhance schema builder to surface index creation errors and ensure indexes are generated alongside table creation (`a798d57`)

### 🧪 Tests

- Refactor `schemaBuilder` test suite for readability and add assertions for index creation (`f43cf26`)

---

## [v1.1.0] - 2025-09-23

This release introduces comprehensive migration management and soft delete functionality. See detailed notes in `v1.1.0 Release Notes.md`.

### 🚀 Features

- **Migration Management**: Add full migration support with `SchemaMigrations` model and `MigrationManager` class (`46f29b0`)
- **Migration Tutorial**: Add comprehensive migration tutorial with example schemas and migration scripts (`7e04823`)
- **Soft Delete Enhancement**: Add soft delete checks in `QueryModel` and `TableModel` methods (`3840fc4`)
- **Example Projects**: Initialize pg-schemata-min-example with database connection and user model (`7bd8c86`)
- **Dependency Management**: Add package overrides for exceljs, rimraf, and unzipper dependencies (`e9d4d73`)

### 📚 Documentation

- **Enhanced WHERE Documentation**: Refactor documentation for WHERE clause modifiers with detailed descriptions and examples (`5bbb650`)
- **Improved Readability**: Remove repeated lines and syntax to enhance readability (`7226b72`)
- **Updated Documentation**: Refactor documentation for pg-schemata and schemaTypes (`90e5620`)
- **Changelog Updates**: Update changelog for latest commits and enhancements (`69f4cb9`)

### 🐛 Fixes

- **Installation Instructions**: Update installation command to specify package name (`95acfb8`)
- **Installation Instructions**: Update installation instructions to remove package name (`d7b0150`)

---

## [v1.0.0] - 2025-08-16

This marks the first stable release. See detailed notes in `v1.0.0 Release notes.md`.

### 🚀 Features

- Add `upsert` and `bulkUpsert` methods to `TableModel` with comprehensive tests (`2143fb7`, `f7a8fa1`)
- Add `buildValuesClause` method to generate SQL-safe VALUES clause for bulk data (`03f5215`)
- Add soft delete checks in `QueryModel` and `TableModel` methods to respect `deactivated_at` (`3840fc4`)
- Add initial TypeScript configuration via `tsconfig.json` (`99a4961`, `19bc9db`)
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

- Change `pgp` and `db` exports to use getter functions for improved encapsulation (`4c53b5d`)
- Streamline `findWhere` method calls in QueryModel integration tests (`ce0e4d9`)
- Enhance test context to drop and recreate schema for cleaner integration tests (`2143fb7`)
- Update count methods in `QueryModel` to use `countWhere` for consistency
- Remove unused `insert` and `exportToSpreadsheet` methods from `TableModel`
- Remove unused parameters from `TableModel` method documentation
- Refactor `exportToSpreadsheet` to directly assign rows from `findWhere`

### 🐛 Fixes

- Streamline `upsert` error handling and enhance `importFromSpreadsheet` to optionally return inserted rows (`ecd8cac`)
- Ensure a primary key is defined in schema for `TableModel` constructor (`050d06f`)
- Remove leftover whitespace and console logs in `TableModel` (`f310cc6`)
- Update error messages in `TableModel` constructor validation (`2143fb7`)
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
