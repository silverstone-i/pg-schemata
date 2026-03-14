# ADR-0004: Singleton DB Pattern via DB.init()

**Status:** Accepted
**Date:** 2025-04-17

## Context

pg-promise recommends a single database instance per application. Options:

- **Dependency injection** — Pass db to each model. More testable but verbose; every consumer function needs a db parameter.
- **Factory function** — Create on demand. Risk of multiple instances violating pg-promise's one-instance recommendation.
- **Singleton with static init** — One-time setup, globally accessible.

## Decision

Static `DB.init()` singleton. Repositories auto-attached via pg-promise `extend()` hook. Access via `db()` and `pgp()` getter functions.

## Consequences

- **Accepted trade-off:** Only one database connection per process. Cannot connect to multiple databases simultaneously (see PRD §7 Constraints).
- **Accepted trade-off:** Global state. Initialization order matters.
- **Benefit:** Idiomatic pg-promise pattern. Clean access: `db().users.findById(id)`.
