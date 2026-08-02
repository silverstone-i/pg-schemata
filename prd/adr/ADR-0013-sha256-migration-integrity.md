# ADR-0013: SHA-256 Hash Verification for Migration Integrity

**Status:** Accepted — amended 2026-08-02 (v2.0.0: verification enforced)
**Date:** 2025-09-23

## Context

If a migration file is modified after it has been applied, the database state no longer matches what the file describes. This creates subtle, hard-to-diagnose inconsistencies.

Options:

- **No verification** — Simple but silently allows drift.
- **Checksum on apply** — Compute hash at application time, store alongside migration record. Enables detection (but not automatic enforcement).
- **Checksum on startup** — Compare stored hashes with current files on every application start. More aggressive but adds startup latency.

## Decision

SHA-256 hash computed at apply time, stored in `schema_migrations` table. Combined with advisory locks to prevent concurrent migration execution.

~~Hash verification is stored but not currently enforced on startup — detection is available for consumers who want it, but automatic blocking was deemed too aggressive for v1.~~

**Amendment (v2.0.0, 2026-08-02):** verification is now enforced at apply time. `applyAll()` and `listPending()` compare the stored hash of every already-applied migration against its current content — file bytes for directory-scanned migrations, `sha256(id + description + up.toString())` for registry migrations built with `defineMigration()` — and a mismatch aborts the run before anything executes. The v1 "detection without enforcement" trade-off is retired: applied migrations are immutable, and a correction is a new migration, never an edit.

## Consequences

- **Enforced (since 2.0.0):** a modified applied migration fails the run with an error naming the schema, module, and migration id.
- **Accepted trade-off:** Advisory locks block concurrent migration attempts for the duration of the transaction.
- **Benefit:** Tamper detection. Race condition prevention. Transaction-safe batches.

See PRD §6.7 for the complete migration behavioral contract.
