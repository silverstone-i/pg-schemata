# ADR-0001: Use pg-promise as the Database Driver

**Status:** Accepted
**Date:** 2025-04-17

## Context

pg-schemata needed a PostgreSQL driver for Node.js. Alternatives evaluated:

- **pg (node-postgres)** — Low-level. Full control but no ColumnSet concept, no repository pattern, manual connection management.
- **Knex.js** — Query builder with migrations. Adds its own query DSL that conflicts with "stay close to SQL" (Principle #3).
- **Sequelize / TypeORM** — Full ORMs. Heavy runtime overhead, own schema definition languages, abstract away PostgreSQL features (violates Principle #1).
- **Prisma** — Schema-driven with code generation. Adds build steps, proprietary schema language, opinionated query API.

## Decision

pg-promise. Key factors: ColumnSet helpers for efficient batch operations, `extend()` hook for repository auto-attachment, parameterized queries by default, thin wrapper that stays close to pg.

## Consequences

- **Accepted trade-off:** Tight coupling to pg-promise API — switching drivers would require significant refactoring.
- **Accepted trade-off:** No built-in migration runner — we implemented our own (`MigrationManager`, see ADR-0013).
- **Benefit:** Direct access to all PostgreSQL features without abstraction.
