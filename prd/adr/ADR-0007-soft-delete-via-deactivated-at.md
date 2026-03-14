# ADR-0007: Soft Delete via deactivated_at Timestamptz Column

**Status:** Accepted
**Date:** 2025-08-16

## Context

Soft delete implementation options:

- **Boolean flag** (`is_deleted`) — Simple but loses *when* deletion occurred. No temporal queries possible.
- **Status enum** (`status: 'active' | 'deleted'`) — Extensible but requires enum management and still no timestamp.
- **Timestamp column** (`deactivated_at`) — Records exact deletion time. Enables "deleted in last 30 days" queries, audit trails, and time-based purging.

## Decision

`deactivated_at timestamptz` column, opt-in via `softDelete: true`. NULL = active, timestamp = deactivated at that time.

The column name `deactivated_at` was chosen over `deleted_at` to convey that the record still exists — it's deactivated, not deleted.

## Consequences

- **Accepted trade-off:** Fixed column name — not configurable. Standardization over flexibility (see PRD §7 Constraints).
- **Accepted trade-off:** Developers must know `delete()` = hard, `removeWhere()` = soft.
- **Benefit:** Temporal queries, reversible deletion, audit trail.

See PRD §6.2 for the complete behavioral contract.
