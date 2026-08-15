# 3.0.0 — zod 4, column-type coverage, and a loud top-level `indexes`

Status: **planned**, not started.
Target release: `3.0.0` (`release:major`).

---

## Why this release exists

`pg-schemata` 2.0.0 shipped three changes that, together, make the library unusable for a
schema-first consumer with an ordinary Postgres table set. All three were found by upgrading a
downstream app (Seqori, 26 models, 313 column definitions) from 1.2.2 to 2.0.0. Two are defects
here; the third is a consumer migration that 2.0.0 made silent instead of loud.

### 1. Unmapped column types now throw, and the mapped set is too small

2.0.0 replaced `mapSqlTypeToZod`'s `z.any()` fallback with a `SchemaDefinitionError`
(`src/utils/generateZodValidator.ts:54-60`). Throwing is the right call. The problem is what is
missing from the mapped set.

That consumer uses 15 distinct type strings. Exactly three are unmapped:

| Type | Occurrences | Status |
|---|---|---|
| `time` | 4 | unmapped → throws |
| `text[]` | 4 | unmapped → throws |
| `uuid[]` | 2 | unmapped → throws |

`time` and one-dimensional arrays are ordinary Postgres. A library that rejects them is wrong, not
merely strict. Five of 26 models fail to construct — and because validators are generated eagerly in
the `TableModel` constructor, that is a hard failure at app boot and at migration time, not at first
write.

### 2. Top-level `indexes` is silently ignored

`resolveIndexes` (`src/utils/schemaBuilder.ts:81-87`) reads only `schema.constraints.indexes` and
returns `undefined` otherwise. Its own JSDoc at `72-80` still promises a fallback to "the legacy
top-level `indexes` property", which no longer exists. The 1.8.0 `warnOnce` deprecation notice was
removed in 2.0.0 along with the other deprecations.

`createTableSQL` then compounds it: the index block at `257-276` wraps `createIndexesSQL` in a
`try/catch` that logs at `debug` level and swallows the error, so an invalid index definition
produces a `CREATE TABLE` with no indexes and no signal.

In the consumer, **25 of 26 models** put `indexes` at the top level — 74 definitions, 7 of them
partial-unique. Losing those drops uniqueness guarantees, not just performance. There is currently
no signal at any layer: TypeScript cannot see a plain-JS schema object, `bootstrap()` succeeds, the
app runs, and you find out from a duplicate row months later.

### 3. Dual zod

`package.json` depends on `zod ^3.25.63` (installed 3.25.76). The consumer app is on 4.4.3, and npm
nests a second copy at `node_modules/pg-schemata/node_modules/zod`. A zod-3 object validating a
zod-4 schema throws `TypeError: keyValidator._parse is not a function`.

This is latent for a consumer using zero `colProps.validator` — and it detonates the first time
anyone reaches for that escape hatch, which is exactly the workaround we recommend for unmapped
types. The public API exchanges zod objects in both directions (`colProps.validator` in,
`_schema.validators` out, `validateDto`, `err instanceof ZodError`), all of which require a single
copy.

---

## Release mechanics

Per `CLAUDE.md`:

- Branch off `main`, work, PR back with `gh pr create --base main`. There is no `dev` branch.
- Label the PR **`release:major`** — three changes break consumers: the zod 4 peer, the `.cause`
  issue shape, and the new top-level-`indexes` throw.
- **Never bump the version by hand.** `release-on-merge.yml` does it on `main` after merge.
- **Never run `npm publish`.** Publishing is CI-driven.
- Add entries under `## [Unreleased]` in `CHANGELOG.md` as part of the work — `changelog-check.yml`
  requires it for a release-labeled PR.
- No `Co-Authored-By` lines in commit messages.

Test rules live in `prd/rules/testing-patterns.md`: unit tests fully mocked (no live Postgres),
integration tests through `tests/helpers/integrationHarness.ts`, no `console.log`, no try/catch that
swallows assertion errors.

---

## 1a. Type-mapping coverage — `src/utils/generateZodValidator.ts`

`mapSqlTypeToZod(type, columnName)` is an if/else-if regex chain at lines 22-61.

### Normalize once, then drop every `/i` flag

Trim, collapse interior whitespace runs to a single space, lowercase. **Collapse rather than
strip** — `double precision` and `with time zone` are multi-word. `varchar(10)`'s digit capture is
unaffected. Every downstream pattern then matches against a canonical string, and the `/i` flags on
lines 23-53 become dead weight.

### Arrays — one dimension, postfix form only

Match `/^(.+)\[\s*\d*\s*\]$/`, recurse on the element type, wrap the result in `z.array(...)`:

- `text[]` → `z.array(z.string())`
- `uuid[]` → `z.array(z.guid())`
- `varchar(10)[]` → `z.array(z.string().max(10))` — the element keeps its `.max`

Two deliberate throws:

- **`text[][]` throws.** Postgres does not enforce declared array dimensions — `text[][]` and
  `text[]` are the same type, and a `text[][]` column happily stores a flat array. A nested
  `z.array(z.array(...))` validator would reject rows the database accepts. Better to refuse the
  declaration than to generate a validator that is wrong.
- **`_text` throws**, with a message naming `text[]` as the intended spelling. `_text` is the
  `pg_type` internal name for `text[]`, but it is also a perfectly legal user-defined type
  identifier. Guessing which one the author meant would eventually be wrong.

### `time` / `timetz` → `z.string()` with a regex, not `z.coerce.date()`

pg leaves OID 1083 unparsed, so a `time` column round-trips as the string `"07:00:00"`. `new
Date('07:00:00')` is `Invalid Date`, so `z.coerce.date()` would fail every `time` column in
existence, not just fail to help.

Use a **hand-rolled regex, not `z.iso.time()`**: zod rejects `24:00:00`, which Postgres accepts and
stores as a legal end-of-day value. A validator stricter than the database is a validator that
rejects valid rows.

Document two things in `docs/guide/validation.md`:

- The deliberate asymmetry with `timestamp`/`date`, which stay `z.coerce.date()` because pg *does*
  parse those into `Date` objects.
- That exotic input literals Postgres accepts (`'04:05 PM'`, `'allballs'`) need `colProps.validator`.

### Close these adjacent gaps

Cheap, unambiguous, and several are already claimed by the docs:

`bool`, `float` / `float(n)`, `serial2` / `serial4` / `serial8`, `citext`,
`inet` / `cidr` / `macaddr`, and bare `char` / `bpchar` / `character`.

### Keep throwing on `interval` and `bytea`, by design

Both round-trip asymmetrically — pg returns an object (`interval`) or a `Buffer` (`bytea`), while
inserts accept a string. Any built-in validator would have to be a union broad enough to accept
nearly anything, which is worse than no validator because it looks like protection. Say so
explicitly in the CHANGELOG and the validation guide, and point at `colProps.validator`.

### No `registerColumnType` registry

Rejected deliberately. `colProps.validator` already covers per-column overrides, and a global
registry would silently miss any model constructed before registration — validators are generated
eagerly in the `TableModel` constructor and cached per schema object, so there is no later point at
which the ordering mistake could be reported.

### Two length bugs fixed in passing

`character varying(n)` and `char(n)` both currently fall through to the unsized branch at lines
27-30 and silently lose the `.max(n)` that the validation guide has always documented. The
normalization pass plus explicit sized patterns fixes both. **Expect this to look like a regression
to consumers** — it is a silently-dropped limit finally taking effect. Call it out in the CHANGELOG.

---

## 1b. zod 3 → 4

Only four `src/` files touch zod:

- `src/schemaTypes.ts:5` — `import type { z } from 'zod'`
- `src/QueryModel.ts:37-38` — `import { ZodError } from 'zod'`, `import type { ZodTypeAny } from 'zod'`
- `src/TableModel.ts:15` — `import { ZodError } from 'zod'`
- `src/utils/generateZodValidator.ts:5` — `import { z } from 'zod'`

| Change | Sites | Severity |
|---|---|---|
| `err.errors` → `err.issues` | `QueryModel.ts:605`, `TableModel.ts:178`, `:277`, `:613` | **Hard break** — `.errors` is `undefined` in zod 4 |
| `z.string().uuid()` → **`z.guid()`** | `generateZodValidator.ts:31-32` | **Semantic** — see below |
| `zodType.email()` → `.check(z.email())` | `generateZodValidator.ts:89-91` | Cosmetic; `.email()` is deprecated in v4 |
| `z.ZodTypeAny` → `z.ZodType` | `generateZodValidator.ts`, `schemaTypes.ts:63`, `:233-235`, `QueryModel.ts:38`, `:596` | Cosmetic; public API surface |
| Drop the `as [string, ...string[]]` cast on `z.enum` | `generateZodValidator.ts:153-156` | Simplification |

All four `err.errors` sites are the identical line:

```ts
error.cause = err instanceof ZodError ? err.errors : err;
```

### `z.guid()`, not `z.uuid()` — this is the trap

zod 4's `z.uuid()` enforces RFC 4122 variant bits and **rejects
`FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF`**, which Postgres stores happily and zod 3's
`z.string().uuid()` accepted. The downstream consumer has 131 `uuid` columns. `z.guid()` matches
both Postgres's own validation and the previous behaviour.

The obvious mechanical v4 migration (`z.uuid()`) is the wrong one. Pin the correct choice with a
regression test asserting the all-`F` GUID parses.

### Sequencing: land `.issues` first, under zod 3

`.issues` exists in zod 3 as well as zod 4. Landing that rename as its own commit, **before** the
`package.json` change, keeps the suite green and proves all four sites are covered while the old
accessor is still available as a control.

### `package.json`: move zod to a peer

```jsonc
"peerDependencies": { "zod": "^4.0.0" },
"devDependencies":  { "zod": "^4.x.x", ... }
```

Keep it as a devDependency so the repo's own tests and typecheck still resolve it; remove it from
`dependencies`. A peer makes npm either hoist a single copy or fail loudly with `ERESOLVE`, instead
of silently nesting a second copy that crashes at the first insert.

**This strands zod-3 consumers.** That is intended. Lead the CHANGELOG with it and state the upgrade
order explicitly: **app to zod 4 first, then pg-schemata.**

---

## 1c. Make top-level `indexes` throw

Add `_rejectRemovedTopLevelIndexes` to the `QueryModel` constructor beside the existing
`_rejectRemovedNullableKey`:

- Constructor: `src/QueryModel.ts:93-119` — the call sits alongside line 115.
- Model helper to mirror: `_rejectRemovedNullableKey` at `src/QueryModel.ts:706-716`.

Use `Object.prototype.hasOwnProperty` rather than a truthiness check — an empty `indexes: []` is
just as broken as a populated one, and silently accepting it teaches the wrong lesson. The error
message should name the table and give the exact fix (`move it inside constraints`).

**Not in `resolveIndexes`.** `createTableSQL` swallows index-generation errors at debug level
(`src/utils/schemaBuilder.ts:257-276`), which is the precise failure mode being fixed — a throw from
there would be caught and logged into the void. The constructor is the only place guaranteed to run
before anything else, and it already owns this class of schema rejection.

Also fix the stale JSDoc at `src/utils/schemaBuilder.ts:72-80`, which still documents the removed
legacy fallback.

---

## 1d. Consumer-schema fixture test

The evidence that a real consumer's table structure works under 3.0.0, **without coupling the
repos**. A distilled fixture, not a vendored copy of 26 downstream models — vendored copies drift
the moment the consumer changes a model, and they test the consumer rather than the library.

### `tests/fixtures/consumerSchemas.ts`

Two exported `TableSchema` objects.

**1. `types_coverage`** — one column per distinct type string a real consumer uses. This is the
exhaustive set, verified by grep across all 26 downstream model files:

```
uuid, text, int, integer, numeric, jsonb, boolean, smallint,
timestamptz, date, time, text[], uuid[], varchar(10), bigint
```

Mirror the real declarations, not idealized ones:

- `default: 'gen_random_uuid()'` on the `uuid` primary key, with `immutable: true` and
  `colProps: { cnd: true }`
- `default: "'{}'"` on the `text[]` column
- `default: "'{}'::uuid[]"` on the `uuid[]` column
- `colProps: { mod: ':json' }` on a `jsonb` column
- `hasAuditFields: { enabled: true, userFields: { type: 'uuid', nullable: true, default: null } }`

Both `int` **and** `integer` appear in real schemas — include both, and assert both.

**2. `constraint_coverage`** — the constraint and index shapes:

- a composite `primaryKey` (three columns, no surrogate `id`)
- `foreignKeys` covering `onDelete: 'CASCADE'`, `'SET NULL'`, and `'RESTRICT'`
- `unique` in **both** accepted forms in the same array: a bare `['a', 'b']` and an object
  `{ columns: [...], nullsNotDistinct: true }`
- `checks: [{ expression: "..." }]`, including one whose expression contains a cast
  (`col <@ ARRAY['a','b']::text[]`) so the check parser is exercised against real SQL
- `constraints.indexes` covering plain, `unique: true`, and `unique: true` + `where: '<predicate>'`

### `tests/unit/consumerSchemaCoverage.test.ts`

Mocked `db`/`pgp` per `prd/rules/testing-patterns.md`. Assert:

- Both schemas construct a `TableModel` with no throw. This alone is the regression net for §1a —
  it fails today on `time`, `text[]`, and `uuid[]`.
- Every generated validator accepts a representative value and rejects a wrong-typed one.
- `time` accepts `'07:00:00'` **and** `'24:00:00'`.
- `uuid` accepts `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF` — the `z.guid()` pin from §1b.
- `text[]` accepts `['a','b']` and rejects `'a'`; `uuid[]` rejects an array containing a non-GUID.
- `varchar(10)` accepts a 10-char string and rejects an 11-char one.

### `tests/integration/consumerSchemaCoverage.integration.test.ts`

Through `createTestContext` from `tests/helpers/integrationHarness.ts` — unique throwaway schema per
run, `DATABASE_URL` from `.env`, teardown drops the schema.

This is the only place that proves the round trip, i.e. that what pg actually returns matches what
the new validators expect:

- Create both tables, insert a full row, read it back.
- Assert `time` comes back as the string `'07:00:00'` (not a `Date`), `text[]` and `uuid[]` come
  back as JS arrays, and `numeric` comes back as a string.
- Assert the base validator parses the row pg returned, unmodified.
- Query `pg_indexes` and assert every `constraints.indexes` entry landed, with `UNIQUE` and `WHERE`
  both present in the `indexdef` of the partial-unique one.

---

## 1e. Remaining tests, changelog, docs

### Tests

- **`tests/unit/generateZodValidator.test.ts`** — array mapping including the `text[][]` and `_text`
  throws; `time`/`timetz` accept and reject sets; the normalization pass (mixed case, padded,
  multi-space `double  precision`); the new scalar aliases; the `char(n)` and
  `character varying(n)` `.max` regressions; the `z.guid()` pin.
- **`tests/unit/QueryModel.schemaNormalization.test.ts`** — top-level `indexes` throws; `indexes: []`
  throws; `constraints.indexes` is accepted (negative control, so the guard cannot over-fire).
- **`error.cause` has zero test coverage today.** `grep -rn cause tests/` finds only comments. That
  absence is exactly why the `.errors` → `.issues` break would have shipped silently. Add one
  assertion per catch site (`QueryModel.ts:605`, `TableModel.ts:178`, `:277`, `:613`);
  `Array.isArray(err.cause)` alone would have caught it.

### Docs

- **`docs/guide/validation.md` is stale** — its type table still documents the pre-2.0.0 `z.any()`
  fallback. Rewrite the table against the new mapped set, and add sections on: why `time` is a
  string, one-dimensional arrays only, the deliberate `interval`/`bytea` gap and the
  `colProps.validator` escape hatch, and the `.cause` issue shape.
- **`prd/adr/ADR-0006-zod-for-runtime-validation.md` is also stale** — its Consequences section still
  claims unmappable types "fall back to `z.any()`". Amend it, or supersede it with a new ADR that
  records the zod 4 peer decision and the `z.guid()`-over-`z.uuid()` reasoning.
- **`CHANGELOG.md`** under `## [Unreleased]`, led by the zod 4 peer and the upgrade order. Cover:
  the peer requirement and `ERESOLVE`, the `.cause` issue shape, the top-level-`indexes` throw with
  the one-line migration, the new mapped types, the deliberate `interval`/`bytea` gap, and the
  `char(n)` / `character varying(n)` length fix that will look like a regression.

---

## Suggested commit order

1. `err.errors` → `err.issues` at all four sites, **plus the `.cause` tests**, still on zod 3.
   Suite stays green; this proves coverage before the accessor disappears.
2. Type-mapping rewrite in `generateZodValidator.ts` (normalization, arrays, `time`, the scalar
   aliases, the two length fixes) plus its unit tests.
3. `package.json` peer change and the remaining zod-4 API renames (`z.guid()`, `.check(z.email())`,
   `z.ZodType`, the dropped enum cast).
4. `_rejectRemovedTopLevelIndexes` plus the schema-normalization tests and the JSDoc fix.
5. The consumer fixture and its two tests.
6. Docs, ADR, CHANGELOG.

---

## Verification

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration     # needs DATABASE_URL in .env
npm run build
npm run check:exports
```

Then confirm the two behaviours that have no other guard:

```bash
# exactly one zod resolves from the built package
node -e "console.log(require.resolve('zod', {paths:[process.cwd()]}))"

# no lingering z.string().uuid() or err.errors
grep -rn "\.uuid()\|err\.errors" src/
```

## Handoff to the consumer

The consumer installs `dist/` (`files: ["dist", "README.md"]`), so it must be built before linking:

```bash
cd /Users/ian/Code/pg-schemata
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
npm run build
npm link
```

The consumer then runs `npm link pg-schemata` in its own package and verifies that a **single** zod
resolves — `node_modules/pg-schemata/node_modules/zod` must be gone. Once 3.0.0 is published, the
link is replaced with a normal `^3.0.0` dependency; a link state is never committed.

---

## Risks

1. **`err.errors` → `.issues` has zero test coverage today.** Miss one of the four sites and
   `.cause` silently becomes `undefined`. Land it first, under zod 3, with tests.
2. **`z.uuid()` vs `z.guid()`** — 131 downstream columns ride on this. The obvious v4 migration is
   the wrong one.
3. **The zod 4 peer strands zod-3 consumers** with `ERESOLVE`. Intended; lead the CHANGELOG with it
   and state the upgrade order.
4. **`char(n)` / `character varying(n)` gaining `.max(n)`** will be reported as a regression. It is a
   silently-dropped limit finally taking effect.
5. **The top-level-`indexes` throw is a hard break at construction time** for any consumer still on
   the old placement — by design, since the alternative is the current silent data-integrity loss.
   The CHANGELOG must give the one-line fix.
