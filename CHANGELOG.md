# 📦 Changelog

All notable changes to **pg-schemata** will be documented in this file.

---

Latest commit: `99c75e3`

---

## [v1.6.0] - 2026-07-27

> Released to npm as **1.6.0**. Versions 1.4.0 and 1.5.0 were bumped by the release automation but never published: the publish step failed before the workflow's tag handling was fixed, and each rerun re-counted the same release label. All changes below shipped together in 1.6.0.

### ✨ Features

- **`forSchema(name)`**: returns a model bound to the given schema without mutating the instance it is called on. Clones are cached (one per instance/schema pair, LRU-bounded like the ColumnSet cache) and carry a ColumnSet built for the target schema. This removes the race where two interleaved requests sharing one repository both wrote to whichever schema was set last. `callDb()` and `bootstrap()` now route through it

- **`options.tx` on every mutating method**: pass a pg-promise task/transaction context (`insert(dto, { tx: t })`) to run the statement inside it. Previously only `bulkInsert`/`bulkUpdate` honored the undocumented `this.tx` property, so a flow mixing bulk and single-row calls under one assignment was only half-transactional — a rollback undid the bulk work while the single-row statements had already committed on the pool

### ⚠️ Deprecations

- **Column key `nullable`**: nothing ever read it — DDL and validator generation use `notNull` — so schemas written with `nullable: false` silently created fully nullable tables. `nullable: false` is now treated as `notNull: true` (one-time warning); the alias is removed in 2.0.0. The shipped `schema_migrations` schema, the example schema, and the audit `userFields.nullable` config are corrected to produce real NOT NULL columns
- **`this.tx`**: still honored — now consistently by every mutating method instead of two — but it mutates shared instance state and leaks between concurrent requests. Use `options.tx` or the pg-promise `t.<repo>` pattern. Removal planned for 2.0.0
- **`setSchemaName()`**: mutates the shared model instance and races under concurrent requests — the exact failure `forSchema()` eliminates. Still functional; emits a one-time warning. Removal planned for 2.0.0

### 🐛 Fixes

- **Column Defaults No Longer Inserted as Literal Strings**: a column with a SQL `default` that is omitted from an insert DTO now emits the `DEFAULT` keyword so Postgres applies the column default. Previously the default expression itself was inserted as data — `role` defaulting to `"'user'"` stored the five-character string `'user'` quotes included, and a `timestamptz` defaulting to `now()` failed with `22007 invalid input syntax`
- **Double-Formatted Updates**: `bulkUpdate` and `updateWhere` executed fully-formatted statements with a values array, so pg-promise ran a second format pass over the whole query. Any stored text containing `$1` (a note like `refund $1 processed`) corrupted the statement and let data control SQL structure. Both now format once and execute with no values, matching `update()`. `bulkUpdate` also reuses one ColumnSet across records with the same key set instead of building one per row
- **Bulk Inserts Threw on `$n` Tokens in Data**: `bulkInsert` and `bulkUpsert` passed `[]` as the values argument for already-formatted queries, so pg-promise still ran the formatter and failed with `Variable $1 out of range` on any value containing a `$n` token. Both now pass `undefined`, which skips formatting entirely
- **`countWhere`/`findWhere` Silently Ignored Object Conditions**: passing a plain object (the shape `exists()` requires) failed the `conditions.length` check, so `countWhere({ score: 5 })` counted the whole table with no WHERE and no error. Both methods now accept an array or a plain object and throw `SchemaDefinitionError` on anything else
- **`reload` Ignored Its Options**: `reload(id, { includeDeactivated: true })` forwarded options to `findById`, which takes only an id, so soft-deleted records could never be reloaded. It now routes through `findOneBy` and honors the flag
- **`$max`/`$min`/`$sum` Subqueries Ignored Soft Delete**: the aggregate subquery scanned soft-deleted rows even when the outer query excluded them, so `findWhere([{ score: { $max: true } }])` returned nothing whenever the extreme value belonged to a deleted row. The subquery now applies the same `deactivated_at IS NULL` filter as the outer query
- **Soft-Delete Guard Skipped on Filters-Only Queries**: `findWhere`/`countWhere` applied the `deactivated_at IS NULL` guard inside `buildWhereClause`, which only runs when conditions are present — `findWhere([], 'AND', { filters: {...} })` returned soft-deleted rows. The guard now lives with the callers (via a shared `softDeleteGuard()` helper) and is appended once after both the conditions and filters branches. This also removes the duplicated predicate `deleteWhere`/`removeWhere` used to emit and the dummy `{ id: { $ne: null } }` condition in `findAll`
- **`buildValuesClause` Always Threw**: it passed the ColumnSet container `{ [table], insert, update }` where pg-promise expects a ColumnSet, so every call to this documented API failed. It now uses the table's ColumnSet
- **Identifier Lists Validated and Escaped**: `returning`, `conflictColumns`, and `updateColumns` reached the SQL raw in `upsert`, `bulkInsert`, `bulkUpdate`, `bulkUpsert`, and `importFromSpreadsheet`. They are now validated against the schema's columns and escaped; an unknown name throws `SchemaDefinitionError`
- **DDL Defaults With Apostrophes**: a string column default containing a quote (`O'Brien`) produced invalid `CREATE TABLE` SQL; embedded quotes are now escaped
- **Validator Type Coverage**: `integer`, `bigint`, `smallint`, `int2/4/8`, `timestamptz`, `numeric(p,s)`, bare `varchar`, `char(n)`, `real`, and `double precision` previously fell through to `z.any()`, so garbage passed validation for those columns. All are now mapped; a genuinely unknown type still falls back to `z.any()` with a one-time warning (throws in 2.0.0). The email enhancement uses `instanceof z.ZodString` instead of the zod-3-only `_def.typeName`
- **`findWhere` Limit/Offset Validation**: non-numeric values produced `LIMIT NaN` (invalid SQL); they now throw `SchemaDefinitionError`. The old truthiness gate also dropped `limit: 0` and `offset: 0`, which are now honored
- **`bulkInsert` Key-Set Mismatch**: records with different column sets failed with an opaque pg-promise error deep in the batch; the mismatch is now detected up front and the error names the offending record index and both column lists
- **Per-Tenant Migrations**: `MigrationManager.ensure()` created `schema_migrations` in `public` regardless of the configured schema, while `currentVersion()` and `applyAll()` read from the target schema — so `applyAll()` failed with `42P01` for any non-public schema. `ensure()` now binds the model to the target schema via `forSchema()`
- **Soft Delete Without Audit Fields**: the constructor no longer skips schema normalization when `hasAuditFields` is false, so `softDelete: true` adds the `deactivated_at` column on its own. Previously every query on such a table failed with `42703 column "deactivated_at" does not exist`. The soft-delete step now lives in its own `addSoftDeleteField` helper, and the caller's schema object is cloned before normalization instead of being mutated

### 🛠 Chores

- **Logging Defers to the Host Logger**: `logMessage` dropped debug output when `NODE_ENV === 'production'`; the library now hands every message to the logger you supply and lets it decide levels
- **Dead Code Removed**: the no-op builtin-function replace loop in `createTableSQL` (both branches returned `match`) and the commented-out `costlines` debug block are gone; the constructor error message no longer claims to check a primary key it never checked
- **Dead Files Removed**: `src/utils/ddlGenerator.js` (a single comment line that shipped in the npm tarball) and the three empty `Examples/` stubs (`db.js`, `models/User.js`, `schemas/userSchema.js`) are deleted; the working examples live under `Examples/migration-tutorial/` and `Examples/pg-schemata-min-example/`

### ⚡ Performance

- **Validator Cache**: pg-promise rebuilds every repository for each task and transaction; Zod validators are now generated once per schema (WeakMap keyed on the schema literal) instead of on every rebuild — previously ~1.9 ms per transaction for 20 repositories

---

## [v1.3.3] - 2026-05-15

### 🐛 Fixes

- **Audit Fields on Insert**: `insert` and `bulkInsert` now auto-fill `updated_by` when audit fields are enabled, matching the behavior of `update`/`bulkUpdate` and `upsert`/`bulkUpsert`

### 🛠 Chores

- **TypeScript Config**: Set `moduleResolution` to `Bundler` in `tsconfig.json`
- **ESLint**: Ignore `docs/.vitepress/dist` and `docs/.vitepress/cache` build output

### 🎨 Style

- Reformat `src/TableModel.js` (no behavior changes)

---

## [v1.3.2] - 2026-05-07

### 🐛 Fixes

- **Cross-Schema Foreign Keys**: `createTableSQL` now honors a target schema on foreign key constraints
  - Add optional `references.schema` to `ConstraintDefinition` for explicit cross-schema FK targets
  - Bare `references.table` falls back to `references.schema` (or the owning schema if absent)
  - Dotted `references.table` (e.g. `'admin.countries'`) still takes precedence when both forms are supplied
  - Constraint-name hash now incorporates `references.schema` when present, preventing collisions for FKs differing only by target schema (existing constraint names unchanged for bare/dotted forms)
  - Multi-dot `references.table` values (e.g. `'a.b.c'`) now throw `SchemaDefinitionError` instead of silently truncating
  - `createTableSQL` accepts `schemaName` as an alias for `dbSchema`, matching `createIndexesSQL`

### 🛠 Chores

- **Dependencies**: Update `@nap-sft/tablsx` to `0.1.3`

---

## [v1.3.1] - 2026-03-14

### 🛠 Refactors

- **Excel Library Migration**: Replace `@nap-sft/xlsxjs` with `tablsx` for spreadsheet read/write functionality

### 📚 Documentation

- **VitePress Migration**: Migrate documentation from MkDocs to VitePress with new guide and reference pages
- **PRD & ADRs**: Add Product Requirements Document with Architecture Decision Records and project rules

---

## [v1.3.0] - 2026-02-13

### 🚀 Features

- **Audit Actor Resolver**: Add configurable `auditActorResolver` callback for dynamic actor injection in CRUD operations
  - Registered via `DB.init()` options to resolve the current actor at query time for `created_by`/`updated_by` audit fields
  - Replaces the need for consumer-side prototype patching
  - Takes priority over the static `_auditUserDefault` fallback

### 🐛 Fixes

- **Upsert Audit Fields**: `upsert` and `bulkUpsert` now include `updated_by` in the `ON CONFLICT SET` clause
- **Soft Delete Audit Fields**: `removeWhere` and `restoreWhere` now set `updated_by` and `updated_at` when audit fields are enabled

### 🧪 Tests

- Add unit tests for `auditActorResolver` module
- Add soft-delete integration tests for audit field behavior
- Update existing TableModel integration and unit tests

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
