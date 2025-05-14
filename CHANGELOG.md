# Changelog

## [Unreleased]

### 🚀 Features
- `TableModel.createTable()` supports table creation from schema definitions.
- `QueryModel` enables flexible read-only access, including:
  - `findWhere`, `count`, `findById`, `findOneBy`
  - Enhanced support for `$in`, `$like`, and nested conditions.
- Automatic audit field support (`created_by`, `updated_by`, timestamps).
- Column customization with `colProps` and `ColumnSet` extensions.
- DTO sanitization ensures schema validation and integrity.
- Native JSONB and varchar(n) field support.
- Pagination, ordering, and filtering logic is fully parameterized.
- Logging enabled for `createTableSQL`, `createColumnSet`, and `sanitizeDto`.

### ♻️ Refactors
- Merged `BaseModel` and `ReadOnlyModel` into `TableModel`.
- Extracted query logic to `QueryModel` for reuse.
- Streamlined schema and model structure across project.
- Removed legacy method scaffolding and deprecated interfaces.
- Rewrote audit field injection using array-based, conditional logic.

### 🐛 Fixes
- Corrected return behavior of `update()` to return `null` when record not found.
- Improved error messages during insert and query generation.
- Fixed debug output in table creation logging.

### 🧪 Experimental
- Logical condition operators are now standardized using `$` prefixes:
  - Use `$or` and `$and` instead of `or` and `and`. The old forms are deprecated.
  - This aligns with JSON-based DSL conventions (e.g. MongoDB, Mongoose).
- Full documentation of supported operators is available in [`./design_docs/querymodel-conditions.md`](./design_docs/querymodel-conditions.md).
- Planned extensions include support for `BETWEEN`, `NOT`, `EXISTS`. Nested logical operators like `$and` and `$or` are already supported.

### 📦 Dependencies
- Added: `lodash`

### 📌 Reference Commit
- Latest commit included in this changelog: `5163bac` (2025-05-11)
