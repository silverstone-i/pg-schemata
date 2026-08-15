# ADR-0006: Zod for Runtime DTO Validation

**Status:** Accepted
**Date:** 2025-06-22

## Context

DTOs need runtime validation before hitting the database. Alternatives:

- **Manual validation** — Per-method checks. Tedious, error-prone, inevitably diverges from schema.
- **JSON Schema + ajv** — Mature but requires maintaining a separate JSON Schema definition.
- **Joi / Yup** — Validation libraries requiring separate schema definitions that drift from the table schema.
- **Zod** — TypeScript-first, can be auto-generated from existing data structures.

The key insight: the table schema already describes types and constraints. A validator should be _derived_ from it, not maintained separately (Principle #2).

## Decision

Auto-generate Zod validators from the table schema via `generateZodFromTableSchema()`. Three variants (base, insert, update) cover all validation needs.

## Consequences

- **Accepted trade-off:** Zod is a dependency. As of 3.0.0 it is a _peer_ dependency (`zod ^4`), not a bundled one — see ADR-0014.
- **Accepted trade-off:** Complex check constraints can't be auto-mapped. Only `char_length(col) > n` and `col IN (...)` are read; anything else is left to the database.
- **Benefit:** Validation stays synchronized with schema automatically — impossible to forget to update.

> **Superseded in part by [ADR-0014](ADR-0014-zod-4-peer-dependency.md) (3.0.0).**
> This ADR originally recorded that unmappable column types "fall back to `z.any()`".
> That stopped being true in 2.0.0, when the fallback became a `SchemaDefinitionError`.
> ADR-0014 records the throw-don't-guess decision, the zod 4 peer dependency, and the
> `z.guid()`-over-`z.uuid()` choice.

See PRD §6.5 for the complete behavioral contract including type mapping and invariants.
