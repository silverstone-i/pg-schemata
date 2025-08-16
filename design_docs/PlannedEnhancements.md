# Possible Future Enhancements for Soft Delete Support

The following features are proposed as optional future enhancements to extend soft delete functionality in pg-schemata:

---

## 🕒 softDeletedSince(daysAgo)
- Utility method to return records where `deactivated_at` is older than `NOW() - interval 'X days'`.

---

## 🚫 markInactive()
- Shortcut for soft deleting a record by `id`.
- Example: `markInactive(id)` is equivalent to `removeWhere({ id })`.

---

## ✅ isActive(id)
- Boolean check to determine if a record is active.
- Inverse of `isSoftDeleted(id)`.

---

## 🧹 autoPurge(thresholdDays)
- Scheduled cron utility to permanently delete records where `deactivated_at` is older than a threshold.


# Possible Future Enhancements for Soft Delete Support

The following features are proposed as optional future enhancements to extend soft delete functionality in pg-schemata:

---

## 🕒 softDeletedSince(daysAgo)
- Utility method to return records where `deactivated_at` is older than `NOW() - interval 'X days'`.

---

## 🚫 markInactive()
- Shortcut for soft deleting a record by `id`.
- Example: `markInactive(id)` is equivalent to `removeWhere({ id })`.

---

## ✅ isActive(id)
- Boolean check to determine if a record is active.
- Inverse of `isSoftDeleted(id)`.

---

## 🧹 autoPurge(thresholdDays)
- Scheduled cron utility to permanently delete records where `deactivated_at` is older than a threshold.

---

# 🔧 DDL and Schema Enhancements

## ⚡ Automatic Index on `deactivated_at`
- Auto-generate an index when `softDelete: true`.
- Example: `CREATE INDEX ON schema.table (deactivated_at);`

---

## 🔐 Partial Unique Constraints
- Allow optional `uniqueWhere` to support partial uniqueness on active rows.
- Example: `CREATE UNIQUE INDEX ... WHERE deactivated_at IS NULL;`

---

## 📊 Generated Columns for Deactivation Age
- Automatically add computed fields like:
  `deactivated_days GENERATED ALWAYS AS (CURRENT_DATE - deactivated_at::date) STORED`

---

## 📝 DDL Comments (Documentation)
- Support per-column comments via schema definitions.
- Example: `COMMENT ON COLUMN schema.table.deactivated_at IS 'Set when record is soft-deleted';`

---

## 🧭 Default Audit Indexes
- Auto-index common audit fields such as `created_at`, `updated_at`.

---

# 🧠 Other Enhancements

## 🧪 Declarative Test Stubs
- Auto-generate test harness templates for each schema with base CRUD tests.

## 🔄 DTO Versioning / Migrations
- Extend `TableSchema.version` support with DTO-specific enhancements:
  - Allow multiple Zod DTOs for different schema versions (e.g., `dtoVersions: { 1: ..., 2: ... }`)
  - Enable transformation functions between DTO versions to maintain backward compatibility
  - Support declarative schema migrations keyed by version number
  - Expose versioned DTO contracts for frontend use (e.g., nap-client)

## 🧰 Role-Based Permissions at Model Level
- Declarative role access control (e.g., `readRoles`, `writeRoles`) in table schema metadata.

## 🧱 Embedded Relationships
- Support defining joins or lookups declaratively, for future eager-loading or scaffolding.

## 🪛 Column Type Plugins
- Pluggable field types (e.g., JSONB enum types, IP address, geometric shapes, etc.)

## 📜 Migration Scripts
- Support automatic generation of SQL migration scripts when schema versions change.
- Could include DDL diffing and timestamped migration file generation for CI/CD workflows.