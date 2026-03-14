# ADR-0003: QueryModel/TableModel Class Hierarchy

**Status:** Accepted
**Date:** 2025-04-17

## Context

The library needs both read-only and read-write access patterns. Options:

- **Single class** with all methods — simpler, but no way to restrict write access for read-only use cases (reporting, dashboards, read replicas).
- **Separate unrelated classes** — duplication of all query/WHERE builder logic.
- **Inheritance** — read-only base extends to read-write. No duplication, but coupling.

## Decision

Two-class inheritance: QueryModel (read-only) → TableModel (extends, adds writes).

QueryModel owns the WHERE builder, DTO sanitization, error handling, and all read methods. TableModel adds write operations and Zod validation.

## Consequences

- **Accepted trade-off:** Changes to QueryModel affect all TableModel instances (inheritance coupling).
- **Benefit:** Consumers can use QueryModel for least-privilege read-only access.
- **Benefit:** Zero duplication of query logic.
