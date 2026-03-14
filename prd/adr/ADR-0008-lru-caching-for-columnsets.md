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
