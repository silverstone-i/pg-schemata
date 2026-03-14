# ADR-0006: Zod for Runtime DTO Validation

**Status:** Accepted
**Date:** 2025-06-22

## Context

DTOs need runtime validation before hitting the database. Alternatives:

- **Manual validation** — Per-method checks. Tedious, error-prone, inevitably diverges from schema.
- **JSON Schema + ajv** — Mature but requires maintaining a separate JSON Schema definition.
- **Joi / Yup** — Validation libraries requiring separate schema definitions that drift from the table schema.
- **Zod** — TypeScript-first, can be auto-generated from existing data structures.

The key insight: the table schema already describes types and constraints. A validator should be *derived* from it, not maintained separately (Principle #2).

## Decision

Auto-generate Zod validators from the table schema via `generateZodFromTableSchema()`. Three variants (base, insert, update) cover all validation needs.

## Consequences

- **Accepted trade-off:** Zod is a runtime dependency (~50KB).
- **Accepted trade-off:** Complex check constraints can't be auto-mapped and fall back to `z.any()`.
- **Benefit:** Validation stays synchronized with schema automatically — impossible to forget to update.

See PRD §6.5 for the complete behavioral contract including type mapping and invariants.
