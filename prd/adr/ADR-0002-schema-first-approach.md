# ADR-0002: Schema-First Table Definitions via JavaScript Objects

**Status:** Accepted
**Date:** 2025-04-17

## Context

Table structure can be defined through several approaches:

- **Migration-driven** (Knex) — No single file describes the current table structure; you must replay all migrations mentally.
- **Decorator-driven** (TypeORM) — Requires TypeScript, experimental decorator support, ties schema to class definitions.
- **Schema introspection** (Prisma) — Generates code from database state or proprietary schema file. Adds build steps and a proprietary language.
- **Plain object definition** — One JavaScript object, no build step, machine-readable.

## Decision

Plain JavaScript objects. One object per table drives DDL generation, ColumnSet creation, Zod validator generation, and CRUD behavior — so they can never drift from each other.

This became Design Principle #2: "Schema object is the single source of truth."

## Consequences

- **Accepted trade-off:** Schema and database can drift if DDL is modified outside pg-schemata. No introspection to detect drift.
- **Accepted trade-off:** No automatic migration generation from schema changes (planned — see PRD §8).
- **Benefit:** One file, one object, one truth — machine-readable and diffable.
