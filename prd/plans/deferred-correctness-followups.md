# Deferred correctness follow-ups

**Status:** open
**Recorded:** 2026-08-16, during the 3.0.0 documentation-and-correctness pass
**Source:** external code review of `fix/update-partial-dto`

An external review raised fifteen findings against the 3.0.0 branch. Two were
already fixed on the branch; ten were fixed during that pass. Three are recorded
here because they were deliberately not taken, each for a different reason.

This document exists so the list survives outside the conversation that produced
it. A reader of the branch sees the ColumnSet cache, the CRUD layer, and the
repository typing untouched, and would reasonably infer the review found nothing
there.

---

## 1. The ColumnSet cache can return another model's columns

**Where:** `src/utils/schemaBuilder.ts`, `createColumnSet` — the cache key is
`` `${schema.table}::${schema.dbSchema}` ``.

**Problem.** The key carries no fingerprint of the schema definition and no
identity for the pg-promise instance. Two different schema objects describing
the same `dbSchema.table` therefore share one cache entry, and the first one
constructed wins for the lifetime of the entry.

**Reproduction.** Define two schemas both named `public.things`, the first with
column `a` and the second with column `b`. Construct a model from each. The
second model's ColumnSet contains column `a`.

**Blast radius.** Narrow but not theoretical. It needs two distinct definitions
of the same qualified table name in one process — which happens in test suites
that build fixture variants, in codebases with a legacy and a current model for
one table during a migration, and in any library consumer that constructs models
from a second pg-promise instance. The 10-minute TTL bounds it but does not
prevent it.

**Why deferred.** The fix is larger than it looks. A correct key needs a stable
hash over the parts of the schema the ColumnSet actually derives from — column
names, every `colProps` field including function-valued `skip` and `init`, and
the audit configuration — plus a per-`pgp` identity, following the
`_cloneCacheId` pattern already used by `forSchema()`. Function-valued fields
cannot be hashed by value, so the design question is whether to hash by
reference identity (correct, but defeats caching across structurally identical
schema literals) or to accept that two schemas differing only in a `skip`
implementation collide. That decision wants its own review, and it interacts
with ADR-0008.

**Suggested approach.** Hash by reference identity for function-valued fields.
Caching across separately-constructed but structurally identical schemas is not
the case the cache exists to serve — the hot path is one schema object reused
across many `forSchema()` calls, which keeps reference identity anyway.

---

## 2. Arbitrary and composite primary keys are advertised but CRUD hardcodes `id`

**Where:** `src/TableModel.ts` — `delete` (`WHERE id = $1`), `update`,
`bulkUpdate`; `src/QueryModel.ts` — `findById`, `reload`, and the soft-delete
helpers.

**Problem.** `constraints.primaryKey` is typed `string[]` and generates a
correct `PRIMARY KEY` constraint of any arity, but every row-targeting method
matches on a column literally named `id`. A table with a composite key, or one
whose key column is named anything else, gets valid DDL and silently wrong row
targeting. `bulkUpdate` is the clearest case: it reads the declared primary key
for validation and then targets `id` regardless.

**Why deferred.** This is a feature, not a defect fix. Making the CRUD layer
key-agnostic changes the signature of six public methods — they must accept a
key object rather than a scalar — and forces a decision about the single-key
shorthand, which is what nearly every consumer uses. That is an ADR, a major
version, and a migration guide.

**What was done instead.** The single-`id` requirement is now documented as a
hard constraint rather than left implied, in the schema-definition guide, the
`schema-types` and `table-model` references, and the PRD. Composite primary keys
are stated as unsupported by the by-id methods, with `findWhere`/`updateWhere`/
`deleteWhere` named as the alternative.

**Suggested approach.** An ADR proposing `findById(key)` where `key` is either a
scalar (interpreted against `primaryKey[0]`, requiring arity 1) or an object
keyed by column name. Reject the scalar form at construction for composite-key
schemas so the failure is loud.

---

## 3. Repository type augmentation does not enforce its documented contract

**Where:** `src/DB.ts` — `RepositoryMap` is
`{ [K in keyof Repositories]: RepositoryCtor<Repositories[K]> } | Record<string, RepositoryCtor>`;
`src/utils/callDB.ts` — `callDb` retains a `(modelOrName: string, schemaName: string)` overload.

**Problem.** The union's second arm accepts any string-keyed map, so the mapped
type in the first arm never constrains anything: a `DB.init` call omitting a
declared repository, or supplying one whose instance type does not match the
declaration, compiles. The documented benefit of augmenting `Repositories` — that
the registry is checked against the declaration — does not hold. `callDb`'s
string overload has the same effect at the call site: any string is accepted and
returns a bare `SchemaAwareModel`.

**Why deferred.** Removing the permissive arm is a compile-time breaking change
for every consumer that has not augmented `Repositories`, which is the default
state — they would go from "compiles" to "does not compile" with no runtime
signal that anything was wrong. That needs a deprecation path or, at minimum, a
prominent migration note, and it is orthogonal to the correctness work this
branch carries.

**Suggested approach.** Keep the permissive arm only when `Repositories` is
empty, using a conditional type on `keyof Repositories extends never`. That gives
unaugmented consumers today's behavior and augmented ones the checking they were
promised, with no flag day.

---

## Fixed on this branch, for contrast

Recorded so a future reader does not re-triage them: partial `update()` writing
omitted columns; `colProps` discarded on the bulk write paths; three
`findAfterCursor` defects; `buildWhereClause` OR precedence; audit timestamps
gated on actor resolution; `findOneBy` missing its limit; generated-column DDL;
write-validator nullability; schema-name and `joinType` injection; `$and`/`$or`
dropping sibling predicates; index-generation errors swallowed in
`createTableSQL`; and the shipped examples.
