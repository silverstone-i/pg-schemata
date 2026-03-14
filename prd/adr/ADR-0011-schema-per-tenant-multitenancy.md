# ADR-0011: PostgreSQL Schema-Per-Tenant for Multi-Tenancy

**Status:** Accepted
**Date:** 2025-04-17

## Context

Multi-tenant isolation strategies:

- **Row-level tenancy** (`tenant_id` column) — Simple but requires every query to filter by tenant. One missed WHERE clause leaks data.
- **Separate databases** — Maximum isolation but operationally expensive: separate connections, backups, and migrations per tenant.
- **Schema-per-tenant** — PostgreSQL schemas provide strong isolation within one database. One connection pool, per-schema table creation and migrations.

## Decision

Schema-per-tenant as the primary multi-tenancy pattern. Each table schema has a `dbSchema` property; models can switch schemas at runtime via `setSchemaName()`. Single connection pool shared across all tenants.

This leverages PostgreSQL's native schema mechanism (Principle #1) rather than application-level isolation logic.

## Consequences

- **Accepted trade-off:** Schema proliferation with thousands of tenants may impact `pg_catalog` performance.
- **Accepted trade-off:** Schema must be set correctly before each operation — wrong schema = wrong tenant.
- **Benefit:** Strong native isolation. Single connection pool. Cross-tenant queries still possible for admin use cases.
- **Neutral:** Row-level tenancy is not prevented — consumers can combine both patterns.

See PRD §6.9 for behavioral invariants.
