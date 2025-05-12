# Changelog

## [Unreleased]

### 🚀 Features

- Added `createTable()` to support table creation directly from schema (`BaseModel`, now `TableModel`)
- Introduced `ReadOnlyModel` to enforce read-only data access patterns
- Improved support for audit fields, nullable fields, and validation in `createTableSQL` and `createColumnSet`
- Added logging support to schema tools and models (`createTableSQL`, `createColumnSet`, `sanitizeDto`)
- Enhanced query building: improved WHERE clause generation, pagination, and flexible insert/update logic
- Added `colProps` support for advanced pg-promise ColumnSet customization
- Allowed `varchar(n)` syntax via extended `ColumnDefinition`
- Allowed JSONB fields and formatted audit fields in table schemas
- Repository constructors validated during DB class initialization

### ♻️ Refactors

 #### refactor: extract query methods to QueryModel and clean up TableModel
   - Moved read-only query logic (e.g. findWhere, count, findById) to new QueryModel base class
   - Refactored TableModel to extend QueryModel and removed duplicate methods
   - Simplifies inheritance structure and avoids code duplication

- Renamed `BaseModel` → `TableModel`
- Renamed `ReadOnlyModel` → `QueryModel` 
- Added `ReadOnlyModel` class
- Removed `BaseModel` and `ReadOnlyModel` classes (merged functionality into `TableModel`)
- Restructured codebase to isolate reusable query and schema logic
- Rewrote audit field injection to be array-based with conditional logic
- Simplified column object creation with lodash and utility functions
- Cleaned up test and script definitions in `package.json`

### 🐛 Fixes

- Corrected return type of `update()` to include `null` if record doesn’t exist
- Improved error handling in insert and query construction
- Fixed incorrect debug logging in `createTableSQL`
- Enhanced DTO sanitization to set defaults for `created_by` and `updated_by`

### 📦 Dependencies

- Added `lodash` as a dependency

## [0.1.0-beta.1] - 2025-04-17

### Added

- Initial beta release of `pg-schemata`.
- Core features include:
  - `TableModel` class for CRUD operations and filtering.
  - `DB` class for singleton database connection handling.
  - Schema definition utilities: `createColumnSet`, `addAuditFields`.
  - Input validation utilities.
  - Full JSDoc-based documentation generator support.
  - Support for unit and integration tests with Jest.
