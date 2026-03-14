# ADR-0013: SHA-256 Hash Verification for Migration Integrity

**Status:** Accepted
**Date:** 2025-09-23

## Context

If a migration file is modified after it has been applied, the database state no longer matches what the file describes. This creates subtle, hard-to-diagnose inconsistencies.

Options:
- **No verification** — Simple but silently allows drift.
- **Checksum on apply** — Compute hash at application time, store alongside migration record. Enables detection (but not automatic enforcement).
- **Checksum on startup** — Compare stored hashes with current files on every application start. More aggressive but adds startup latency.

## Decision

SHA-256 hash computed at apply time, stored in `schema_migrations` table. Combined with advisory locks to prevent concurrent migration execution.

Hash verification is stored but not currently enforced on startup — detection is available for consumers who want it, but automatic blocking was deemed too aggressive for v1.

## Consequences

- **Accepted trade-off:** Detection without enforcement. Modified files are detectable but won't automatically block application startup.
- **Accepted trade-off:** Advisory locks block concurrent migration attempts for the duration of the transaction.
- **Benefit:** Tamper detection. Race condition prevention. Transaction-safe batches.

See PRD §6.7 for the complete migration behavioral contract.
