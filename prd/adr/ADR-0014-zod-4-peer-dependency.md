# ADR-0014: Zod 4 as a Peer Dependency, and Validating Only What Postgres Validates

**Status:** Accepted
**Date:** 2026-08-15
**Supersedes in part:** [ADR-0006](ADR-0006-zod-for-runtime-validation.md)

## Context

Upgrading a downstream consumer (26 models, 313 column definitions) from 1.2.2 to 2.0.0 surfaced
three problems that share one root cause: pg-schemata's validators were being designed against
Zod's defaults rather than against PostgreSQL's actual behaviour.

1. **Two copies of zod.** `zod` was a hard `dependencies` entry pinned to `^3.25.63`. A consumer on
   zod 4 got a second copy nested at `node_modules/pg-schemata/node_modules/zod`. The public API
   exchanges zod objects in both directions — `colProps.validator` in, `_schema.validators` out,
   `validateDto`, `err instanceof ZodError` — and all of it requires a single instance. A zod-3
   object validating a zod-4 schema throws `TypeError: keyValidator._parse is not a function`.

2. **Ordinary Postgres types were unmapped.** `time`, `text[]`, and `uuid[]` had no mapping, and
   2.0.0 had (correctly) replaced the `z.any()` fallback with a throw. Because validators are
   generated eagerly in the `TableModel` constructor, that was a hard failure at app boot.

3. **Zod's stricter defaults rejected valid rows.** Most sharply, zod 4's `z.uuid()` enforces the
   RFC 4122 variant bits and rejects `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF`, which Postgres stores
   without complaint.

## Decision

### 1. zod is a peer dependency, `^4.0.0`

```jsonc
"peerDependencies": { "zod": "^4.0.0" },
"devDependencies":  { "zod": "^4.x.x" }
```

npm then either hoists a single copy or fails loudly with `ERESOLVE`, instead of silently nesting a
second one that crashes at the first `colProps.validator`. It stays a devDependency so the repo's
own tests and typecheck still resolve it.

This strands zod-3 consumers, which is intended and stated in the CHANGELOG: upgrade the app to
zod 4 first, then pg-schemata.

### 2. The validator must never be stricter than the database

Where Zod's built-in and Postgres disagree about what is valid, Postgres wins. A validator stricter
than the database rejects rows the database accepts, which is worse than no validator — it fails on
correct data.

Concretely:

- **`z.guid()`, not `z.uuid()`.** `z.guid()` matches Postgres's own `uuid` validation and zod 3's
  previous `z.string().uuid()` behaviour. The obvious mechanical v4 migration is the wrong one.
- **A hand-rolled time regex, not `z.iso.time()`.** Zod rejects `24:00:00`; Postgres accepts and
  stores it as a legal end-of-day value.
- **`numeric` and `bigint` accept strings.** `pg` returns OIDs 1700 and 20 as strings to preserve
  precision, so a row read straight back out of the database must satisfy its own validator.
- **`time` maps to a string, not a date.** `pg` leaves OID 1083 unparsed; `z.coerce.date()` would
  fail every `time` column in existence.

The integration suite pins this: a row inserted, read back, and parsed by its own base validator.

### 3. Unmapped types throw; there is no registry

A type with no mapping raises `SchemaDefinitionError` rather than falling back to `z.any()`. A
validator that accepts anything looks like protection while providing none.

`interval` and `bytea` are left unmapped **deliberately**. Both round-trip asymmetrically — `pg`
returns an object or a `Buffer` while inserts accept a string — so any built-in validator would have
to be a union broad enough to accept nearly anything.

A `registerColumnType` registry was considered and rejected. `colProps.validator` already covers
per-column overrides, and a global registry would silently miss any model constructed before
registration: validators are generated eagerly in the constructor and cached per schema object, so
there is no later point at which the ordering mistake could be reported.

### 4. Multi-dimensional arrays are refused, not approximated

Arrays map one dimension deep, postfix form only. `text[][]` throws, because Postgres does not
enforce declared array dimensions: `text[][]` and `text[]` are the same type, and a `text[][]`
column happily stores a flat array. A nested `z.array(z.array(...))` would reject rows the database
accepts. Refusing the declaration beats generating a validator that is quietly wrong.

## Consequences

- **Breaking:** zod-3 consumers get `ERESOLVE` until they upgrade. Deliberate.
- **Breaking:** `.cause` is now `ZodError.issues`; `.errors` no longer exists in zod 4.
- **Breaking:** `char(n)` and `character varying(n)` now enforce `.max(n)`. This will be reported as
  a regression; it is a silently-dropped limit finally taking effect.
- **Benefit:** one zod instance, so `colProps.validator` and `instanceof ZodError` work.
- **Benefit:** the generated validators agree with the database, which the round-trip integration
  test now enforces rather than assumes.
- **Cost:** each new type mapping needs a round-trip check against a real Postgres, not just a
  reading of the zod docs. That is the point.
