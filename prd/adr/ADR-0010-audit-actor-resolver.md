# ADR-0010: Module-Level Audit Actor Resolver Callback

**Status:** Accepted
**Date:** 2026-02-13

## Context

Prior to v1.3.0, injecting the current user into `created_by`/`updated_by` audit fields required either:

1. **Static default** in the schema — can't reflect request-scoped users.
2. **Prototype patching** — fragile, non-obvious, breaks encapsulation.

Neither approach worked cleanly with request-scoped middleware (Express + AsyncLocalStorage).

## Decision

Module-level callback resolver: `setAuditActorResolver(fn)` registers a synchronous function that returns the current actor ID at query time. Registered once at startup via `DB.init()` options.

Why synchronous-only: keeps the insert/update hot path simple. Async resolution would complicate every write method for a use case (async actor lookup) that doesn't exist in practice — AsyncLocalStorage is synchronous.

Why module-level singleton (not per-model): one resolver per process matches the one-db-per-process pattern (ADR-0004). Per-model resolvers would add complexity for a use case no one has needed.

## Consequences

- **Accepted trade-off:** Global state — only one resolver at a time (see PRD §7 Constraints).
- **Accepted trade-off:** Synchronous only.
- **Benefit:** Clean integration with AsyncLocalStorage. No prototype patching. Backward compatible.

See PRD §6.3 for the complete behavioral contract including priority chain.
