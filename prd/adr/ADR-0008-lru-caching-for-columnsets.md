# ADR-0008: LRU Caching of ColumnSet Definitions

**Status:** Accepted
**Date:** 2025-06-22

## Context

In multi-tenant applications using `extend()`, every new connection triggers ColumnSet creation for every repository. With hundreds of tenants sharing identical table structures, this is redundant computation.

Options:

- **No caching** — Simple but wasteful. O(tenants × tables) ColumnSet creations per connection cycle.
- **Simple object cache** — Unbounded memory growth risk.
- **LRU cache** — Bounded memory with automatic eviction of least-used entries.

## Decision

LRU cache via `lru-cache` package. Key: `${table}::${dbSchema}`, max 20,000 entries, 1-hour TTL.

## Consequences

- **Accepted trade-off:** Cache invalidation is TTL-based. Schema changes during runtime won't reflect until expiry.
- **Accepted trade-off:** Adds `lru-cache` as a runtime dependency.
- **Benefit:** Significant performance improvement in multi-tenant scenarios. Transparent to consumers.
- **Narrowed scope (3.0.0):** The cache no longer covers the update paths. A ColumnSet that spans every column in the table cannot serve a partial update — pg-promise substitutes a value for whatever the DTO omits — so `update`, `updateWhere`, `upsert`, `bulkUpsert`, `bulkInsert` and `bulkUpdate` each build a ColumnSet per call from the DTO's own keys. The cached `cs.update` variant is still constructed, because `cs` is a public property, but nothing reads it. `bulkUpdate` memoizes within a single call, keyed by sorted key set, so a batch of same-shaped rows still builds one ColumnSet rather than one per row; the other paths build one per call. Correctness over reuse: the cached variant was fast and wrong.
