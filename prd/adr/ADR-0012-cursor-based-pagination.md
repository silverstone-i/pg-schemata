# ADR-0012: Cursor-Based (Keyset) Pagination

**Status:** Accepted
**Date:** 2025-06-22

## Context

Pagination strategies:

- **Offset pagination** (`LIMIT N OFFSET M`) — Simple API but degrades at scale. Database must scan and skip M rows: O(M+N). Page 1000 is dramatically slower than page 1.
- **Cursor-based (keyset) pagination** — Uses the last seen value as the starting point. Consistent O(N) performance regardless of depth.

## Decision

Keyset pagination via `findAfterCursor()`. Uses PostgreSQL tuple comparison: `WHERE (col1, col2) > ($1, $2)`.

## Consequences

- **Accepted trade-off:** No "jump to page 50" capability. Clients must track cursor values.
- **Accepted trade-off:** Requires stable, unique ordering columns.
- **Benefit:** Consistent performance at any depth. Natural fit for PostgreSQL tuple operators.

See PRD §6.8 for behavioral invariants.
