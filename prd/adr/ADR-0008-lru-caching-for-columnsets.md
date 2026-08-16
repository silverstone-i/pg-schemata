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

LRU cache via `lru-cache` package. Max 20,000 entries, 1-hour TTL.

Key (revised in 3.0.0): `${pgpId}::${table}::${dbSchema}::${fingerprint}`, where
`pgpId` is a per-pg-promise-instance identity and `fingerprint` is a SHA-256 digest
over everything `createColumnSet` reads — every column's name, type, default
presence, immutability and `colProps`, plus the audit configuration and the
primary key.

The original key was `${table}::${dbSchema}` alone. See Consequences.

## Consequences

- **Accepted trade-off:** Cache invalidation is TTL-based. Schema changes during runtime won't reflect until expiry.
- **Accepted trade-off:** Adds `lru-cache` as a runtime dependency.
- **Benefit:** Significant performance improvement in multi-tenant scenarios. Transparent to consumers.
- **Corrected key (3.0.0):** The original `${table}::${dbSchema}` key described the table's _name_ rather than its _definition_, so two schema objects for one qualified table shared an entry and whichever was constructed first won until the TTL expired — a model declaring column `b` received a ColumnSet built for column `a`. It needs two definitions of one qualified name in a single process: fixture variants in a test suite, a legacy and a current model coexisting mid-migration, or a second pg-promise instance. The key now includes a fingerprint of the definition and a per-pgp identity.
- **Accepted trade-off (3.0.0):** `colProps.skip`, `colProps.init` and `colProps.validator` cannot be hashed structurally — two are functions and one is a Zod object with opaque internals — so they contribute reference identities from a `WeakMap` instead. Two structurally identical schema _literals_ therefore miss the cache and build separate ColumnSets. That is deliberate: the case the cache exists to serve is one schema object reused across many `forSchema()` calls, which keeps reference identity and still hits. Correctness over hit rate.
- **Narrowed scope (3.0.0):** The cache no longer covers the update paths. A ColumnSet that spans every column in the table cannot serve a partial update — pg-promise substitutes a value for whatever the DTO omits — so `update`, `updateWhere`, `upsert`, `bulkUpsert`, `bulkInsert` and `bulkUpdate` each build a ColumnSet per call from the DTO's own keys. The cached `cs.update` variant is still constructed, because `cs` is a public property, but nothing reads it. `bulkUpdate` memoizes within a single call, keyed by sorted key set, so a batch of same-shaped rows still builds one ColumnSet rather than one per row; the other paths build one per call. Correctness over reuse: the cached variant was fast and wrong.
