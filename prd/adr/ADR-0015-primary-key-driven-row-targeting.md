# ADR-0015: Primary-key-driven row targeting

**Status:** Accepted
**Date:** 2026-08-16
**Supersedes in part:** [ADR-0003](ADR-0003-class-hierarchy-querymodel-tablemodel.md)

## Context

`TableSchema.constraints.primaryKey` has always been typed `string[]`, and
`createTableSQL` has always emitted a `PRIMARY KEY` constraint of whatever arity
it declares. `TableModel`'s constructor rejects a schema that omits it.

None of that reached the row-targeting methods. `findById`,
`findByIdIncludingDeactivated`, `reload`, `isSoftDeleted`, `update`, `delete` and
`bulkUpdate` all matched on a column literally named `id`. `bulkUpdate` stated
the contradiction outright: it read `constraints.primaryKey`, threw if it was
absent, and then targeted `dto.id`.

The consequences scaled with how far a schema strayed from `primaryKey: ['id']`:

- **Renamed key** (`primaryKey: ['code']`, no `id` column) — every by-id call
  failed with `column "id" does not exist`. Loud, but the schema was documented
  as supported.
- **Composite key** (`['tenant_id', 'user_id']`) — the constraint was created
  correctly and the by-id call matched on `id` alone. On a table carrying both a
  surrogate `id` and a composite business key, that silently hit the wrong row.

An external review raised this in August 2026. The 3.0.0 documentation pass
initially recorded the single-`id` requirement as a hard constraint, which was
accurate but conceded a limitation the schema type never implied.

## Decision

Row targeting resolves from `constraints.primaryKey`.

Two forms are accepted:

- A **scalar**, resolved against `primaryKey[0]`. Single-column keys therefore
  need no call-site change, whatever the column is named.
- An **object** carrying exactly the declared columns, for composite keys.

A scalar passed to a composite-key model throws `SchemaDefinitionError` naming
the columns to supply. An object with missing or unexpected keys names both sets.

`constraints.primaryKey` must be an array of column names. A bare string throws
at model construction — it was previously accepted because nothing iterated it,
and iterating a string yields its characters.

Two protected helpers on `QueryModel` implement this:
`_primaryKeyCondition()` returns a condition object for the parameterized paths,
and `_primaryKeyClause()` returns an inlined fragment for `update` and
`bulkUpdate`, whose statements are assembled as literal strings by
`pgp.helpers.update()` and executed with no parameter array. Both route
identifiers through `pgp.as.name()` and values through pg-promise's escaping.

### Rejected: object-only keys

`findById({ id })` everywhere is uniform and unambiguous, but breaks every
existing call site for the overwhelmingly common single-key case. The scalar form
is not a legacy concession — it is the right ergonomics for the shape most tables
have.

### Rejected: a separate `findByKey()`

Fully backward compatible, but leaves two ways to do one thing and lets
`findById` keep its wrong behavior indefinitely. The bug is that `findById`
ignores the schema, not that it lacks a sibling.

## Consequences

- **Breaking, narrowly.** A schema declaring a composite primary key previously
  "worked" by targeting `id`; it now requires the object form. That is the fix.
  A bare-string `primaryKey` now throws.
- **`bulkUpdate` requires every key column on each record**, and excludes them
  from the `SET` list rather than only deleting `id`.
- **Emitted SQL now quotes the key column** — `WHERE "id" = ...` rather than
  `WHERE id = ...`, since the identifier goes through `pgp.as.name()`. Cosmetic,
  but it changes exact-match assertions in downstream tests.
- **Single-column `['id']` schemas are unaffected** at every call site.
- The CRUD layer no longer contradicts the schema type, so
  `docs/guide/schema-definition.md` documents composite keys as supported rather
  than carrying a warning that they are not.
