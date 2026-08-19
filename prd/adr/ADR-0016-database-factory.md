# ADR-0016: Database Factory via createDb()

**Status:** Accepted
**Date:** 2026-08-19
**Supersedes:** ADR-0004 (Singleton DB Pattern via DB.init())
**Amends:** ADR-0010 (Module-Level Audit Actor Resolver Callback)

## Context

ADR-0004 accepted one database per process. That no longer holds: NAP needs a
single Node process to hold an admin database handle and one or more cell
database handles, with more cells added over time.

The singleton blocked this in four places: `DB.init()` no-ops after the first
call; the repository registry lives in the `extend()` closure of the one
pg-promise root; `MigrationManager` and `bootstrap()` read `DB.db` / `DB.pgp`;
and the audit actor resolver is a module-level variable.

## Decision

`createDb(config)` returns an independently owned `Database` instance. Each one
owns its pg-promise root, pool, frozen repository registry, logger, audit actor
resolver, schema cache, migration target, and lifecycle.

**Separate pg-promise roots per instance.** `extend` and the initialization
options live on the root, so a separate root is the only way to give an instance
its own repository registry. It also isolates the instance's init options. It
does **not** isolate node-postgres's process-wide type parsers.

**`db.$pool.end()`, never `pgp.end()`.** `pgp.end()` calls
`DatabasePool.shutDown()`, which destroys every pool in the process from a
registry held on a `global` symbol — it would break the isolation this ADR
exists to provide. Instance shutdown ends only its own pool.

**Unique database context per instance.** pg-promise's duplicate-database
warning is keyed on connection details plus the database context, so a unique
default `dc` keeps deliberately separate handles from being reported as
duplicates without switching warnings off globally.

**Ownership is not overridable on instance methods.** `Database.migrate()`,
`migrationManager()`, and `bootstrap()` omit the `db` / `pgp` / `owner` /
`auditActorResolver` keys from their option types and assign them after
spreading caller options. `bootstrap()` also omits `db`, because the standalone
function runs on a supplied executor _instead of_ the owner — accepting it would
let `adminDb.bootstrap({ db: cellTx })` write to the cell database.

**Scoped audit resolver with no global fall-through.** The resolver is carried on
models by an internal enumerable Symbol (enumerable so `Object.assign` in
`forSchema()` copies it to schema-bound clones), stamped before schema binding in
the `extend()` hook, `instantiateBound()`, migration catalog and dependency-order
models, `SchemaMigrations`, and bootstrap models. Resolution checks the symbol's
_presence_, so an instance resolver that returns `null` stays isolated rather
than falling through to another database's global resolver.

**Per-instance repository typing.** `createDb()` infers repository types from the
constructor map it is given, so two instances expose different, correctly typed
repositories. The globally augmented `Repositories` interface continues to type
the singleton API only.

**`DB` retained as the compatibility default instance.** `DB.init()` builds one
`Database` through `createDb()` and republishes its handles. `DB.db` and `DB.pgp`
remain writable public fields — reassignment is discouraged but not broken — and
`DB.close()` is added as the supported reset path.

## Consequences

- **Benefit:** Several databases in one process, with no shared pool, registry,
  schema state, migration configuration, or resolver.
- **Benefit:** Closing one handle leaves every other handle usable.
- **Accepted trade-off:** `instance.db` stays public, so the raw handle and any
  repository reference captured earlier bypass the closed-state guard and produce
  pg-promise's native error after closure.
- **Accepted trade-off:** pg-promise retains closed database objects in its
  process-global bookkeeping until process shutdown, so handles must be
  long-lived rather than per-request.
- **Consumer note:** applications adopting multiple handles must replace
  `pgp.end()` with per-instance `close()`; single-database consumers need no
  changes.

## Out of scope

Tenant routing, cell discovery, credential storage, sharding, RLS helpers,
tenant selection via `search_path` or pooled session state, and any global
registry of instances. Those belong to the consuming application.
