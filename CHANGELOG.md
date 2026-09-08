# 📦 Changelog

All notable changes to **pg-schemata** will be documented in this file.

---

Latest commit: `99c75e3`

---

## [Unreleased]

## [v3.1.1] - 2026-09-08

### Fixed

- Support explicitly named expression indexes via `{ expression: string }`, including unique partial indexes. Preserve identifier validation and reject empty expressions or mixed column/expression definitions; plain strings remain column names.

## [v3.1.0] - 2026-08-19

## [v3.0.0] - 2026-08-16

### 💥 Breaking

- **Minimum supported Node.js raised from 18 to 20.** Node 18 is end-of-life, CI only ever tested 20 and 22, and the `lru-cache` dependency already required `20 || >=22` — so the advertised floor was untested and unusable
- **`upsert()` and `bulkUpsert()` now validate their input.** They went straight from sanitization to SQL while every other write path validated, so invalid types, the automatic email check, and `colProps.validator` rules all reached the database. Upserts that previously succeeded with invalid data will now be rejected up front
- **A condition containing a `Date` now generates the predicate it always should have.** `{ created_at: someDate }` emitted no SQL at all, so `{ created_at: someDate, tenant_id: id }` filtered on `tenant_id` alone and destructive `updateWhere`/`deleteWhere` calls reached more rows than intended. Queries will now return **fewer** rows than before — that is the fix, not a regression
- **A malformed `constraints.indexes` entry now throws at model construction.** One entry with an empty or missing `columns` array previously caused *every* index on the table — unique and partial-unique included — to be dropped silently while the `CREATE TABLE` succeeded
- **`zod` is now a peer dependency and requires zod 4** (`"peerDependencies": { "zod": "^4.0.0" }`). It was previously a bundled `dependencies` entry on zod 3, so npm nested a second copy under any consumer already on zod 4 — and a zod-3 object validating a zod-4 schema throws `TypeError: keyValidator._parse is not a function`. The public API exchanges zod objects in both directions (`colProps.validator` in, `_schema.validators` out, `validateDto`, `err instanceof ZodError`), all of which need a single instance.
  **Upgrade order: move your app to zod 4 first, then pg-schemata.** Installing against zod 3 now fails loudly with `ERESOLVE` rather than silently nesting a broken second copy
- **`SchemaDefinitionError.cause` is now `ZodError.issues`** — zod 4 removed `ZodError.errors`. The value is still an array of issue objects with `path` and `code`; only the accessor it came from changed. Code reading `err.cause[0].message` is unaffected
- **A top-level `indexes` property now throws at model construction** — it has been ignored since 2.0.0, which silently dropped every index including unique and partial-unique ones, with no signal at any layer until duplicate rows appeared. Move it inside `constraints`:
  ```diff
  - indexes: [{ columns: ['email'], unique: true }],
  + constraints: { indexes: [{ columns: ['email'], unique: true }] },
  ```
  An empty `indexes: []` throws too — it is just as misplaced
- **`char(n)` and `character varying(n)` now enforce `.max(n)`** — both previously fell through to the unsized branch and silently dropped the length limit the validation guide has always documented. **Expect this to look like a regression**: it is a dropped limit finally taking effect, and rows that were passing validation while exceeding the declared length will now be rejected
- **`json`/`jsonb` columns marked `notNull` are now actually required on insert** — they mapped to `z.any()`, which makes the object key optional in zod, so a `jsonb NOT NULL` column passed validation with the key absent entirely. The key must be present; its value may still be `null`, because `NOT NULL` rejects SQL NULL but admits the JSON scalar `null`, and `pg` parses both to JavaScript `null`
- **`CHECK` constraints now apply to the column's own type before nullability wrapping.** Three consequences, all cases where the generated validator disagreed with Postgres:
  - `char_length(col) > n` now applies to nullable columns and to `notNull` columns with a default. It was silently dropped for both, because the wrapped value is a `ZodOptional`, which has no `.min`
  - `col IN (...)` no longer discards `.nullable().optional()`. A nullable column with an `IN` check previously **rejected `null`**, though `NULL IN (...)` is unknown and `CHECK` admits unknown
  - Neither check mutates a non-string column any more
- **Minimum supported PostgreSQL raised from 12 to 13** — UUID primary keys default to the core `gen_random_uuid()`, which was added in 13
- **`update()` now owns `updated_at` when audit fields are enabled**, discarding any value the DTO supplies and always writing `CURRENT_TIMESTAMP`. The column is emitted with pg-promise's raw modifier (`mod: '^'`), so a `Date` in the DTO was inlined unquoted as `"updated_at"=2026-01-01T00:00:00.000-05:00` — invalid SQL — and any other value bypassed the audit trail. **Code that deliberately backdates `updated_at`, such as a data import preserving original timestamps, will silently stop doing so**; write those rows with `updateWhere()` or raw SQL instead
- **`bootstrap()` no longer enables `pgcrypto` by default** — the `extensions` option now defaults to `[]`. Nothing in pg-schemata ever called a pgcrypto function; the default was a pre-PostgreSQL-13 artifact from when `gen_random_uuid()` lived in that extension. Pass `extensions: ['pgcrypto']` explicitly if your own schemas still need it
- **`descending: true` now applies to every column in `orderBy`.** `findAfterCursor` emitted `ORDER BY a, b DESC`, so only the last column sorted descending while the keyset predicate `(a, b) < (...)` assumed all of them did. The ordering and the seek disagreed, and multi-column descending pages silently skipped or repeated rows. Single-column cursors are unaffected
- **`findAfterCursor` returns `nextCursor: null` on the last page.** It previously returned a cursor whenever the page was non-empty, so a caller looping `while (nextCursor)` always made one extra round trip for an empty page, and a `do…while` that trusted it never terminated. `null` now means what the guide has always said it means: no more rows. The query asks for `limit + 1` rows and uses the extra one only to decide whether another page exists, so a last page holding exactly `limit` rows is recognized as the last page; callers still receive at most `limit` rows
- **`findAfterCursor` throws when `columnWhitelist` omits an `orderBy` column.** The next cursor is read off the last returned row, so an ordering column that was not projected produced `{ occurred_at: undefined }` — a cursor that could not be passed back in. It now fails with `SchemaDefinitionError` naming the missing columns instead of returning an unusable page token
- **`generated` accepts only `'always'`, and requires `stored: true`.** `ColumnDefinition.generated` was typed `'always' | 'by default'`, but `GENERATED BY DEFAULT AS (expr)` is not valid PostgreSQL — `BY DEFAULT` belongs to identity columns. `stored` was optional, though PostgreSQL 13–17 support only `STORED` generated columns. Both variants were passed through verbatim and failed as a syntax error at bootstrap; `createTableSQL` now throws `SchemaDefinitionError` with the reason. A generated column with no `expression` throws too, rather than silently emitting a plain column
- **`touch()` requires audit fields** and rejects with `SchemaDefinitionError` when they are disabled. It previously produced the unrelated `DTO must be a non-empty object` from two frames down. It takes the same `PrimaryKey` as the rest of the by-id API, so composite-key tables can call it
- **`update()` rejects a DTO with no writable columns.** The emptiness check runs on the DTO as supplied, but sanitization then drops unknown and immutable columns and the update validator strips unknown keys rather than rejecting them — so `update(id, { id })` on a table without audit fields built a ColumnSet with no columns and failed inside pg-promise. It now rejects with `SchemaDefinitionError`. An empty DTO is still accepted when audit fields are enabled, since `updated_at` alone makes a valid update
- **An invalid scalar primary key rejects with `SchemaDefinitionError`**, not a plain `Error`. The message (`Invalid ID format`) is unchanged; only the class is, so the object and scalar key forms now fail the same way
- **Identifiers are validated at model construction, in `forSchema()`, and in DDL generation.** Every schema, table, column, constraint and index name must match `/^[A-Za-z_][A-Za-z0-9_$]*$/` and fit PostgreSQL's 63-byte limit. Query paths already routed identifiers through `pgp.as.name()`, but DDL generation builds statements as strings, so a schema name such as `tenant"; DROP TABLE customers; --` closed its own quoting and appended a second statement during `bootstrap()` or a migration — and `forSchema()`, the entry point most likely to receive a request-derived value, accepted any non-empty string. The check also rejects names past 63 bytes, which PostgreSQL truncates silently so that two schemas differing only in the tail collapse onto one. **Identifiers containing spaces, hyphens, or other characters that previously worked when quoted will now be rejected**; the PRD has always documented snake_case. Raw-SQL fields — `expression`, `where`, `checks[].expression`, `using`, column `type` and `default` — are unaffected and still emitted verbatim
- **`joinType` is checked at runtime.** `JoinType` is a compile-time union that erases, while the value is interpolated between predicates as raw SQL and every public query method forwards it straight from its caller. `buildCondition` now throws `SchemaDefinitionError` for anything other than `'AND'` or `'OR'`
- **An object carrying `$and` or `$or` now also emits its ordinary column keys.** Both branches previously `continue`d, silently discarding every sibling predicate: `{ $or: [...], tenant_id }` filtered on the group alone and dropped the tenancy scope. `FiltersInput` permits that shape, so nothing flagged it, and the SQL was valid — it simply matched more rows than asked for. Siblings join with the outer join type, matching how two plain keys on one object have always behaved. **Queries using this shape will now return fewer rows**; that is the fix. An empty `$or: []` is ignored rather than treated as a column named `$or`
- **Row targeting now resolves from `constraints.primaryKey`** instead of a column literally named `id`. `findById`, `findByIdIncludingDeactivated`, `reload`, `isSoftDeleted`, `update`, `delete`, `bulkUpdate` and `purgeSoftDeleteById` all emitted `WHERE id = $1` whatever the schema declared — `bulkUpdate` read the declared key for validation and then targeted `id` anyway. A table keyed on `code` failed with `column "id" does not exist`; a composite key produced a correct constraint and then matched on `id` alone, silently hitting the wrong row on any table carrying both a surrogate `id` and a composite business key. A **scalar** is still accepted for single-column keys and resolves against the declared column whatever it is named, so `primaryKey: ['id']` schemas need no change; **composite keys take an object**, `findById({ tenant_id, user_id })`. Passing a scalar to a composite-key model throws. `bulkUpdate` requires every key column on each record and excludes them from the `SET` list. See [ADR-0015](prd/adr/ADR-0015-primary-key-driven-row-targeting.md)
- **`constraints.primaryKey` must be an array of column names.** A bare string (`primaryKey: 'id'`) previously passed unnoticed because nothing iterated it; it is now the source of the key columns, and iterating a string yields its characters. It throws at model construction — in `QueryModel`'s constructor, so a directly-instantiated `QueryModel` is covered as well as every `TableModel`
- **The emitted key predicate quotes its column** — `WHERE "id" = …` rather than `WHERE id = …`, since the identifier now goes through `pgp.as.name()`. Cosmetic, but it changes exact-match assertions in downstream tests
- **`DB.init` checks its repository map against an augmented `Repositories`.** `RepositoryMap` was a union whose second arm was `Record<string, RepositoryCtor>`; with `Repositories` un-augmented the first arm collapsed to `{}`, which accepts any non-nullish value — so neither arm constrained anything and a map missing a declared repository, or supplying one of the wrong instance type, compiled. It is now a conditional, so the permissive form applies only while `Repositories` is un-augmented: **consumers who have not declared a registry compile exactly as before**, and those who have get the checking the docs always promised. `callDb`'s unconditional `(name: string)` overload is narrowed the same way
- **Index-generation errors propagate out of `createTableSQL`.** They were caught and logged at debug level so table creation could continue, so one malformed `constraints.indexes` entry silently dropped *every* index on the table — unique and partial-unique included — while the `CREATE TABLE` succeeded and `bootstrap()` reported success. The loss surfaced later as duplicate rows with nothing above debug level connecting them to the schema. `QueryModel`'s constructor already rejected malformed entries; `createTableSQL` is exported and callable directly, which was the remaining silent path
- **The write validators reject an explicit `null` for a `NOT NULL` column.** Nullability and optionality were collapsed into one wrapper: a defaulted `NOT NULL` column was `.nullable().optional()` on insert, and **every** column was `.nullable()` on update. So `insert({ status: null })` and `update(id, { status: null })` both passed validation and failed at PostgreSQL with a constraint violation instead of a Zod issue naming the column. Optionality still works as before — omit a defaulted column and the default applies; every column remains optional on update — but `null` now follows the column. `json`/`jsonb` are unchanged and still accept `null`, since `NOT NULL` admits the JSON scalar `null`. **Code that clears a `NOT NULL` column by passing `null` will now be rejected up front**; it was already failing at the database

### ✨ Added

- **`createDb(config)` — a database factory, so one process can hold several independent PostgreSQL handles.** Each instance owns its own pg-promise root, connection pool, repository registry, logger, audit actor resolver, schema cache, migration target, and lifecycle. An operation through one instance never uses another's pool, models, schema state, or migration configuration, and closing one leaves the others usable:

  ```js
  const adminDb = createDb({ connectionString: ADMIN_URL, repositories: { tenants: Tenants } });
  const cellDb = createDb({ connectionString: CELL_URL, repositories: { orders: Orders } });
  ```

  Repository types are inferred per call, so `adminDb.db.tenants` and `cellDb.db.orders` are typed independently. Routing, cell discovery, and credentials stay with the consuming application — this package only owns connections
- **`Database` lifecycle is idempotent.** `connect()` memoizes concurrent calls and clears the memo on failure so a retry is possible; `close()` ends only that instance's pool (`db.$pool.end()`), shares one shutdown across concurrent and repeated calls, and leaves the instance logically closed even if ending the pool rejects. Afterwards the instance methods throw `DatabaseError('Database instance has been closed')`
- **`Database.forSchema(name)`** binds every repository an instance owns to one ordinary PostgreSQL schema, cached per name in a bounded LRU and cleared on close. It selects a schema and nothing more — no `search_path`, no pooled session state, no tenant routing
- **`Database.migrate()` / `migrationManager()` / `bootstrap()` are locked to their instance.** The `db`, `pgp`, `owner`, and `auditActorResolver` keys are omitted from their option types and assigned after the caller's options, so a migration or bootstrap cannot be pointed at another database by accident
- **Per-instance audit actor resolver.** `createDb({ auditActorResolver })` scopes the resolver to every model that instance builds — repositories, migration models, and bootstrap models alike — and factory instances never fall through to the process-wide `setAuditActorResolver()` value. A resolver returning `null` stays isolated rather than deferring to the global one
- **`callDb(name, schema, instance)`** resolves a repository name against a specific instance, routing through its `forSchema()` so the schema cache and closed-state guard apply. The two-argument forms are unchanged
- **`DB.close()`** closes the default instance, clears `DB.db` / `DB.pgp` and — only when a default instance existed — the resolver registered through `DB.init()`, and leaves the singleton ready for a fresh `init()`. Safe before initialization and when called repeatedly or concurrently
- **`MigrationManager` accepts `db`, `pgp`, and `auditActorResolver`; `bootstrap()` accepts `pgp`, `owner`, and `auditActorResolver`.** Both still fall back to the `DB` singleton when the options are absent, so existing calls are unchanged
- **[ADR-0016](prd/adr/ADR-0016-database-factory.md)** records the factory decision — separate pg-promise roots, `$pool.end()` over `pgp.end()`, unique database contexts, non-overridable ownership, and the scoped resolver. It supersedes [ADR-0004](prd/adr/ADR-0004-singleton-db-pattern.md) and amends [ADR-0010](prd/adr/ADR-0010-audit-actor-resolver.md)
- **One-dimensional array types** — `text[]`, `uuid[]`, `varchar(10)[]`, and so on map to `z.array(...)` with the element validator intact, so `varchar(10)[]` still enforces the per-element length. Whitespace and declared dimensions (`text[3]`, `text [ ]`) are tolerated
- **`time` and `timetz`** map to a string with a time pattern. `pg` leaves OID 1083 unparsed, so a `time` column round-trips as `'07:00:00'` — `z.coerce.date()` would have failed every `time` column in existence. The pattern is hand-rolled rather than `z.iso.time()`, which rejects `24:00:00`, a legal end-of-day value Postgres accepts
- **New scalar aliases** — `bool`, `float`, `float(n)`, `serial2`, `serial4`, `serial8`, `citext`, `inet`, `cidr`, `macaddr`, `macaddr8`, and bare `char` / `bpchar` / `character`
- **`colProps.cast`** — appends a SQL cast to the column, passed through to pg-promise. Needed for typed array columns: pg-promise renders a JavaScript array as a `text[]` literal, and PostgreSQL will not implicitly cast that to `uuid[]`:
  ```js
  { name: 'related_ids', type: 'uuid[]', colProps: { cast: 'uuid[]' } }
  ```
  The builder already forwarded this to pg-promise; only the type declaration was missing
- **[ADR-0014](prd/adr/ADR-0014-zod-4-peer-dependency.md)** records the zod 4 peer decision, the `z.guid()`-over-`z.uuid()` choice, and the principle behind them: the validator must never be stricter than the database

### 🐛 Fixed

- **`update()` no longer overwrites the columns a partial DTO omits.** It built its SET list from the cached `cs.update`, which covers every column in the table, and `createColumnSet` gives each column a `def` — so pg-promise substituted a value for the columns the caller left out instead of omitting them. `update(id, { name: 'x' })` emitted `SET "org_id"=null,"name"='x',"start_date"=null,"workflow_state"=DEFAULT,…`, silently overwriting the rest of the row. It was the one write path not converted to `columnSetColumnsFor` alongside `upsert`, `bulkUpsert`, `updateWhere`, `bulkInsert`, and `bulkUpdate`, and it hit the documented happy path: the CRUD guide's own example and `touch()` both pass partial DTOs. Row-level security masked it wherever the nulled column backed a policy, turning silent corruption into an opaque RLS rejection
- **`colProps` survives on every write path.** `upsert`, `bulkUpsert`, `bulkInsert`, `updateWhere`, and `bulkUpdate` build a ColumnSet per call from the DTO's keys, and they built it from bare column-name strings — discarding `cast`, `mod`, `skip`, `cnd`, and `init`. Only `insert()`, which uses the cached ColumnSet, behaved as documented: a `uuid[]` column with the new `cast` reached Postgres as a `text[]` literal on all five other paths, and `mod: ':json'` was dropped alongside it
- **A compound `CHECK` no longer yields a bogus minimum length.** The `char_length(col) > n` pattern was unanchored, so `CHECK (char_length(code) > 3 OR code = 'x')` produced a `.min(4)` that rejected the legal value `'x'`. Both recognized CHECK forms are now matched only as whole expressions
- **`uuid` columns accept every GUID Postgres does.** The mapping uses `z.guid()`, not zod 4's `z.uuid()`, which enforces RFC 4122 variant bits and rejects values Postgres stores happily — including `FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF` and any GUID whose variant nibble falls outside `8`/`9`/`a`/`b`
- **The ColumnSet cache no longer returns another model's columns.** Its key was `${table}::${dbSchema}` — the table's _name_, saying nothing about the definition behind it — so two schema objects describing one qualified table shared an entry and whichever was constructed first won until the 1-hour TTL expired. A model declaring column `b` received a ColumnSet built for column `a`. It needs two definitions of one qualified name in a single process: fixture variants in a test suite, a legacy and a current model coexisting mid-migration, or a second pg-promise instance. The key now carries a SHA-256 fingerprint of everything `createColumnSet` reads — every column's name, type, default presence, immutability and `colProps`, plus the audit configuration and the primary key — and a per-pg-promise identity. `colProps.def` is typed `unknown` and is serialized with its type tagged rather than through bare `JSON.stringify`, which throws on a `bigint` — a legitimate substitution value — and on a circular object; both fall back to reference identity. `colProps.skip`, `init` and `validator` cannot be hashed structurally and contribute reference identities instead, so two structurally identical schema _literals_ miss the cache; the case the cache exists to serve, one schema object reused across many `forSchema()` calls, still hits. See [ADR-0008](prd/adr/ADR-0008-lru-caching-for-columnsets.md)
- **`buildWhereClause()` no longer leaks soft-deleted rows through an `OR` clause.** It appended ` AND deactivated_at IS NULL` without parenthesizing what came before, and `AND` binds tighter than `OR` — so `a OR b` became `a OR (b AND deactivated_at IS NULL)` and every row matching `a` came back regardless of its deactivation. This is the documented public builder; the internal query methods append the guard themselves and were never affected
- **Audit timestamps no longer depend on resolving an actor.** `removeWhere` and `restoreWhere` set `updated_at = NOW()` inside their `if (actor != null)` branch, so with no resolver configured neither column moved — contradicting the audit-fields guide. `updated_at` records _when_ and is now written whenever audit fields are enabled; `updated_by` records _who_ and is still written only when an actor resolves
- **`update()` no longer erases `updated_by` when no actor resolves.** It assigned the unresolved actor unconditionally, putting `updated_by = null` in the SET list and overwriting whoever last touched the row on every subsequent update. The column is now left alone unless an actor is known or the DTO supplies one
- **`touch()` works without an actor resolver.** It sent an empty DTO to `update()`, which rejected it — so the one method whose entire job is advancing the timestamp could not run unless an actor happened to resolve. `update()` now accepts an empty DTO when audit fields are enabled, since the library-owned `updated_at` alone makes a valid update
- **`findOneBy()` queries with `LIMIT 1`.** It returned `results[0]` and discarded the rest, so the database scanned, serialized and transferred every matching row to produce one. A caller-supplied `limit` is ignored
- **The shipped examples run as documented.** The migration tutorial's runner destructured a `{ applied, files }` shape `applyAll()` has never returned (`applied` is an array of migration descriptors); migration 0001 called `bootstrap()` without the migration's own transaction, so a later failure rolled back the migration record while leaving the tables; migration 0002 re-added columns the committed `ordersSchema` already declares, failing on any fresh database; every foreign key used a `references.dbSchema` key that `ForeignKeyReference` does not have (it is `schema`), silently ignored and correct only by coincidence; and the README's `users` example inserted without an `id` into a schema whose `id` had no default. An integration test now executes the tutorial's schemas and migration sequence so this cannot drift again
- **`numeric` and `decimal` accept the string `pg` returns.** OID 1700 comes back as a string to preserve precision, exactly like `int8`, so a row read straight back out of the database failed its own validator under the old `z.number()` mapping
- **A `char_length` check on an array column no longer becomes an item-count minimum.** The old helper duck-typed `.min`, which was safe only while arrays were unmappable — `z.array()` has a `.min` too, and it means array length
- **`colProps.validator` works at all.** The constructor deep-clones the caller's schema, and that clone walked Zod's internals and produced an object that was no longer a working validator — so every custom validator failed with a `TypeError` (surfaced as `SchemaDefinitionError: DTO validation failed` whose `.cause` was a `TypeError`, not a Zod issue array) on the first insert, update, or upsert. Cloning now preserves Zod instances by reference. This matters more in 3.0.0 than before, since `colProps.validator` is the escape hatch for `interval`, `bytea`, and every unmapped type
- **`NOT NULL` columns reject `null` in every mapped type.** `z.coerce.date()` did not merely accept `null`, it coerced it to the Unix epoch, so a `NOT NULL timestamptz` with no default validated `null`. `json`/`jsonb` are the deliberate exception — see the `notNull` json note above
- **Array validators accept `NULL` elements.** PostgreSQL arrays may contain `NULL` and the column type cannot forbid it, so `pg` returns `['a', null]` for a legal value that the validator rejected — meaning a row read straight back out of the database failed its own base validator
- **CHECK constraints compose instead of overwriting.** Several `char_length` checks on one column no longer let the last one win (the strictest is kept), and an `IN` check no longer discards `varchar(n)`'s `.max(n)`, a `colProps.validator`, or a length hint
- **Type names are normalized once** — trimmed, lowercased, and interior whitespace collapsed — so `DOUBLE   PRECISION` and `Timestamp Without Time Zone` resolve correctly
- **The whole `serial` family is recognized as auto-generated.** `createColumnSet` compared against the literal string `'serial'`, so `smallserial`, `bigserial`, and the newly added `serial2`/`serial4`/`serial8` stayed in the ColumnSet despite being database-generated, and the comparison was case- and whitespace-sensitive (`SERIAL` validated but was not skipped). Both call sites now share one normalized definition, and the `uuid` primary-key arm of the same check gains normalization too
- **A `notNull` serial column is no longer required at insert.** It was required whenever no explicit `default` was declared, forcing the caller to invent a value for a column Postgres populates — which, for plain `serial`, the ColumnSet then discarded. Base and update validators are unchanged: a serial still validates as an integer when a value is supplied

### 🔥 Removed (internal)

- **`validateUUID`** — it enforced RFC 4122 v1–v5 and rejected the all-F GUID the `uuid` mapping now accepts, leaving two contradicting definitions of "valid UUID" in one package. It was unreachable: not exported from the package entry point, not referenced anywhere in `src/`, and the `exports` map is `"."` only, so no deep-path import could reach it either

### 📚 Documentation

- **New [createDb / Database reference](docs/reference/database.md)**, plus multi-database sections in the README, getting-started, migrations, multi-schema, and audit-fields guides. They cover the single-database and admin-plus-cell shapes, lifecycle guidance, migrating a selected database, and state explicitly that callers own tenant-to-cell routing, cell discovery, and secrets
- **`pgp.end()` is documented as unsafe for shutting down one handle** — it destroys every pg-promise pool in the process. Use `instance.close()`, or `DB.close()` for the singleton. The four test teardowns that called it were converted
- **`DB` is documented as the compatibility default instance.** `DB.db` and `DB.pgp` remain writable fields; reassignment is discouraged, and `DB.close()` is the supported reset. The PRD no longer claims one database or one audit resolver per process
- **`Database.info` / `toJSON()` are documented as sanitized, not secret-proof.** They never carry a password or connection string, and values that would require parsing a connection string are absent rather than guessed — but the public `instance.db.$cn` still holds whatever pg-promise was given
- **`constraints.primaryKey` is documented as driving both DDL and row targeting**, with the scalar and object key forms and the composite-key example, in the schema-definition guide, the schema-types and table-model references, and the PRD. An interim version of these pages recorded the single-`id` requirement as a permanent limitation; that is no longer true — see the Breaking entry above
- **`count()` removed from the docs — it never existed.** `docs/reference/query-model.md` documented it as an alias for `countWhere`, and two method lists named it, but there is no `count` on `QueryModel` or `TableModel`. Anyone who followed the reference got `TypeError: db().users.count is not a function`. The entry and both list mentions now say `countWhere`, which is the method that exists and already carried the fuller parameter table. Nothing is removed from the package
- **Partial-update semantics are stated where callers read them.** The CRUD guide, the `update()` and `touch()` reference entries, and their JSDoc now say that only the DTO's own keys are written, that `updated_at` is library-owned and a supplied value discarded, and that `updated_by` is honored when supplied — an asymmetry nothing documented before
- **The PRD's `update()` walkthrough and ColumnSet table match the implementation.** Step 6 still described `pgp.helpers.update(safeDto, this.cs.update, …)`, and the variant table listed `cs.update` as serving "UPDATE operations". Nothing reads `cs.update` any more; it is retained only because `cs` is a public instance property. [ADR-0008](prd/adr/ADR-0008-lru-caching-for-columnsets.md) gains a consequence recording that the cache no longer covers the update paths
- **The cursor-pagination guide documents the multi-column `descending` behavior, the `columnWhitelist`/`orderBy` requirement, and what `nextCursor: null` means**, alongside the fixes above
- **The where-modifiers guide documents boolean groups alongside plain columns**, including what changed in 3.0.0 and the fact that the sibling-object workaround still means the same thing
- **The multi-schema guide documents identifier validation** and notes that it is a backstop rather than an authorization boundary — schema names derived from user input should still be mapped to a known set
- **`QuickStartCheatSheet.md` removed.** Every code block was pre-2.0 and none of it ran: `schema:` instead of `dbSchema`, a CommonJS `require` of an ESM-only package, a two-argument `TableModel` constructor, and four methods that do not exist in `src/` — `setSchema`, `withSchema`, `findManyBy`, and `findWithCursor`. It also recommended `pgp.helpers.update(data, updateColumnSet)`, the exact pattern behind the partial-update data loss fixed above. Nothing linked to it and `package.json` ships only `dist` and `README.md`, so it reached no consumer. The maintained equivalents are the README quick start and [getting started](docs/guide/getting-started.md)

### 📝 Notes

- **Existing single-database consumers need no changes.** `DB.init`, `db()`, `pgp()`, `callDb`, `MigrationManager`, and `bootstrap` keep their signatures and behaviour. Applications adopting multiple handles must replace `pgp.end()` with per-instance `close()`
- **Database handles are meant to be long-lived.** pg-promise keeps closed database objects in process-global bookkeeping until process shutdown, so do not create one per request. The raw `instance.db` handle and repository references captured before `close()` also bypass the closed-state guard and surface pg-promise's own error instead
- **`interval` and `bytea` remain unmapped by design.** Both round-trip asymmetrically — `pg` returns an object or a `Buffer` while inserts accept a string — so any built-in validator would have to be a union broad enough to accept nearly anything, which is worse than no validator because it looks like protection. Use `colProps.validator`
- **`text[][]` throws.** Postgres does not enforce declared array dimensions: `text[][]` and `text[]` are the same type, and a `text[][]` column happily stores a flat array, so a nested validator would reject rows the database accepts
- **`_text` throws**, naming `text[]` as the intended spelling. It is the `pg_type` internal name for `text[]`, but also a legal user-defined identifier, so guessing would eventually be wrong

## [v2.0.0] - 2026-08-02

### 💥 Breaking

- **Migration tracking is now per `(schema_name, module_name, migration_id)`** — the `schema_migrations` table gains `module_name` and `migration_id` (text) columns and drops `version`/`label`; tracking is an applied-set, not a high-water mark. A 1.x-shape table is detected and the run aborts with upgrade guidance (nothing is modified) — see the migrations guide's "Upgrading from 1.x"
- **Migration content hashes are verified on every run** — file bytes for directory-scanned migrations, `sha256(id + description + up.toString())` for registry migrations; a mismatch aborts before anything executes. Applied migrations are immutable: a correction is a new migration, never an edit
- **`MigrationContext` enriched** — `up()` now receives `{schema, module, db, pgp, logger, models, ensureExtensions}` (was `{db, schema}`), with `models` bound to the target schema via `forSchema()`
- **`MigrationManager.currentVersion()` removed** and the `PendingMigration` type replaced by `PendingMigrationInfo`; `applyAll()` returns `{schema, dryRun, moduleOrder, pending, applied}` instead of `{applied, files}`
- **`setSchemaName()` removed** — use `forSchema()` (deprecated with a runtime warning since 1.6.0)
- **Instance-level `model.tx` removed** — pass the transaction per call via `options.tx`, or use the repositories on the tx object (warned since 1.8.0)
- **Column key `nullable` removed** — a schema still passing it throws `SchemaDefinitionError` at model construction (silently ignoring it would flip NOT NULL semantics); use `notNull` (warned since 1.6.0)
- **`schema.schemaName` fallback removed** — rename to `dbSchema` (warned since 1.8.0)
- **Top-level `schema.indexes` fallback removed** — move under `constraints.indexes` (warned since 1.8.0)
- **Lowercase `and`/`or` WHERE keys removed** — use `$and`/`$or` (warned since 1.8.0). Side effect: `findAfterCursor` `$or` filters are now correctly parenthesized against the cursor predicate (the removed lowercase `or` branch emitted an unparenthesized `cursor AND x OR y`)
- **Unknown column types throw** — a column type with no validator mapping raises `SchemaDefinitionError` at model construction instead of falling back to `z.any()` (warned since 1.6.0); supply a supported type or `colProps.validator`
- **`removeWhere` error shape** — rejecting when soft delete is disabled now throws `SchemaDefinitionError` without the non-standard `status: 403` property; catch it and map to your own HTTP status

### ✨ Features

- **`defineMigration({id, description?, up})`** — frozen, checksummed migration objects for registry input; forward-only (no `down()`)
- **Module registry input for `MigrationManager`** — `modules: [{name, models?, migrations}]` with per-module ordered migration arrays (array order is authoritative), mutually exclusive with the directory-scan mode
- **Topological FK sorts** — module-level execution order (`resolveModuleOrder`) and model-level parent-first ordering (`orderModels`, also used by `bootstrap()`); cycles throw with the cycle path in the message; `topoSort` exported for direct use
- **Dry run** — `applyAll({dryRun: true})` reports pending migrations per module and writes nothing
- **Directory scan accepts `.js`** alongside `.mjs`
- **`ensureExtensions` in the migration context** — `CREATE EXTENSION IF NOT EXISTS` with identifier quoting

## [v1.8.0] - 2026-08-02

### ⚠️ Deprecations

- **Runtime one-time warnings added for four previously silent deprecated forms**, all scheduled for removal in 2.0.0:
  - instance-level `model.tx` — pass the transaction per call via `options.tx` instead
  - `schema.schemaName` — rename to `dbSchema`
  - top-level `schema.indexes` — move under `constraints.indexes`
  - lowercase `and` / `or` WHERE keys — use `$and` / `$or`
- Internal: the existing one-time warnings (`setSchemaName()`, column `nullable` alias, unknown Zod column type) now go through a shared `warnOnce` helper; message text is unchanged

## [v1.7.0] - 2026-07-31

### ✨ Features

- **TypeScript migration**: the entire library is now written in TypeScript under `strict` + `noUncheckedIndexedAccess`, compiled to `dist/` with full `.d.ts` declarations and an `exports` map with a `types` condition. Published types are verified with `@arethetypeswrong/cli` in CI and `prepublishOnly`
- **Typed rows (opt-in)**: `QueryModel<TRow = any>` / `TableModel<TRow = any>` — existing subclasses compile and behave unchanged; pass a row interface (`class Users extends TableModel<UserRow>`) to get typed CRUD and query results
- **`Repositories` augmentation**: declare `interface Repositories { users: Users }` via module augmentation and `DB.db`, `db()`, and `callDb('users', …)` become fully typed
- **New public type exports**: `TableSchema`, `ColumnDefinition`, `IndexDefinition`, `WhereCondition`, `FindOptions`, `CursorPage`, `Logger`, and friends, plus runtime constants `CONDITION_OPERATORS` and `PG_ERROR_MESSAGES`
- **`DatabaseError` and `SchemaDefinitionError` are now exported from the package root** — previously they were default-only module exports that `export *` silently dropped, despite being documented as public

### 🔧 Changed

- **Packaging**: `main`/`types` now point at `dist/`; `src/` is no longer published. Undocumented deep imports (`pg-schemata/src/...`) no longer resolve — import from the package root
- **`constraints.indexes` type corrected**: the published type said `ConstraintDefinition[]`, but the SQL generator supports `name`, `unique`, `using`, `where`, `with`, `tablespace`, `ifNotExists`, and object-form columns — now accurately typed as `IndexDefinition[]`. `ConstraintDefinition` also gains the previously missing `onUpdate`
- **Bare-string check constraints generate valid DDL**: `constraints.checks` entries that are plain SQL strings (already accepted by the validator generator) previously produced `CHECK (undefined)` in `createTableSQL`; they now emit the expression
- **`importFromSpreadsheet` callback type**: documented as sync-only, but async callbacks were always awaited — now typed `(row) => Row | Promise<Row>`
- **Copyright headers**: all source and test files now carry the NapSoft LLC copyright notice, enforced by ESLint
- Tooling: Prettier, typescript-eslint (type-checked presets, explicit return types required in `src/`), typecheck/build/format gates in CI and `prepublishOnly`

### 🐛 Fixes

- **Example schema (`tableSchema`)**: the foreign-key example used `references.column` (a key nothing reads) and a `(id)` suffix in the table name; corrected to `references.columns` / `'admin.tenants'`

### 📝 Notes

- `removeWhere`'s "soft delete not enabled" rejection carries a non-standard `status: 403` property on the Error — now explicitly typed; flagged for removal in 2.0.0
- The deprecated `this.tx` instance property and legacy `schema.schemaName` / top-level `schema.indexes` fallbacks are now visible in the types as `@deprecated` optionals

## [v1.6.0] - 2026-07-27

> Released to npm as **1.6.0**. Versions 1.4.0 and 1.5.0 were bumped by the release automation but never published: the publish step failed before the workflow's tag handling was fixed, and each rerun re-counted the same release label. All changes below shipped together in 1.6.0.

### ✨ Features

- **`forSchema(name)`**: returns a model bound to the given schema without mutating the instance it is called on. Clones are cached (one per instance/schema pair, LRU-bounded like the ColumnSet cache) and carry a ColumnSet built for the target schema. This removes the race where two interleaved requests sharing one repository both wrote to whichever schema was set last. `callDb()` and `bootstrap()` now route through it

- **`options.tx` on every mutating method**: pass a pg-promise task/transaction context (`insert(dto, { tx: t })`) to run the statement inside it. Previously only `bulkInsert`/`bulkUpdate` honored the undocumented `this.tx` property, so a flow mixing bulk and single-row calls under one assignment was only half-transactional — a rollback undid the bulk work while the single-row statements had already committed on the pool

### ⚠️ Deprecations

- **Column key `nullable`**: nothing ever read it — DDL and validator generation use `notNull` — so schemas written with `nullable: false` silently created fully nullable tables. `nullable: false` is now treated as `notNull: true` (one-time warning); the alias is removed in 2.0.0. The shipped `schema_migrations` schema, the example schema, and the audit `userFields.nullable` config are corrected to produce real NOT NULL columns
- **`this.tx`**: still honored — now consistently by every mutating method instead of two — but it mutates shared instance state and leaks between concurrent requests. Use `options.tx` or the pg-promise `t.<repo>` pattern. Removal planned for 2.0.0
- **`setSchemaName()`**: mutates the shared model instance and races under concurrent requests — the exact failure `forSchema()` eliminates. Still functional; emits a one-time warning. Removal planned for 2.0.0

### 🐛 Fixes

- **Column Defaults No Longer Inserted as Literal Strings**: a column with a SQL `default` that is omitted from an insert DTO now emits the `DEFAULT` keyword so Postgres applies the column default. Previously the default expression itself was inserted as data — `role` defaulting to `"'user'"` stored the five-character string `'user'` quotes included, and a `timestamptz` defaulting to `now()` failed with `22007 invalid input syntax`
- **Double-Formatted Updates**: `bulkUpdate` and `updateWhere` executed fully-formatted statements with a values array, so pg-promise ran a second format pass over the whole query. Any stored text containing `$1` (a note like `refund $1 processed`) corrupted the statement and let data control SQL structure. Both now format once and execute with no values, matching `update()`. `bulkUpdate` also reuses one ColumnSet across records with the same key set instead of building one per row
- **Bulk Inserts Threw on `$n` Tokens in Data**: `bulkInsert` and `bulkUpsert` passed `[]` as the values argument for already-formatted queries, so pg-promise still ran the formatter and failed with `Variable $1 out of range` on any value containing a `$n` token. Both now pass `undefined`, which skips formatting entirely
- **`countWhere`/`findWhere` Silently Ignored Object Conditions**: passing a plain object (the shape `exists()` requires) failed the `conditions.length` check, so `countWhere({ score: 5 })` counted the whole table with no WHERE and no error. Both methods now accept an array or a plain object and throw `SchemaDefinitionError` on anything else
- **`reload` Ignored Its Options**: `reload(id, { includeDeactivated: true })` forwarded options to `findById`, which takes only an id, so soft-deleted records could never be reloaded. It now routes through `findOneBy` and honors the flag
- **`$max`/`$min`/`$sum` Subqueries Ignored Soft Delete**: the aggregate subquery scanned soft-deleted rows even when the outer query excluded them, so `findWhere([{ score: { $max: true } }])` returned nothing whenever the extreme value belonged to a deleted row. The subquery now applies the same `deactivated_at IS NULL` filter as the outer query
- **Soft-Delete Guard Skipped on Filters-Only Queries**: `findWhere`/`countWhere` applied the `deactivated_at IS NULL` guard inside `buildWhereClause`, which only runs when conditions are present — `findWhere([], 'AND', { filters: {...} })` returned soft-deleted rows. The guard now lives with the callers (via a shared `softDeleteGuard()` helper) and is appended once after both the conditions and filters branches. This also removes the duplicated predicate `deleteWhere`/`removeWhere` used to emit and the dummy `{ id: { $ne: null } }` condition in `findAll`
- **`buildValuesClause` Always Threw**: it passed the ColumnSet container `{ [table], insert, update }` where pg-promise expects a ColumnSet, so every call to this documented API failed. It now uses the table's ColumnSet
- **Identifier Lists Validated and Escaped**: `returning`, `conflictColumns`, and `updateColumns` reached the SQL raw in `upsert`, `bulkInsert`, `bulkUpdate`, `bulkUpsert`, and `importFromSpreadsheet`. They are now validated against the schema's columns and escaped; an unknown name throws `SchemaDefinitionError`
- **DDL Defaults With Apostrophes**: a string column default containing a quote (`O'Brien`) produced invalid `CREATE TABLE` SQL; embedded quotes are now escaped
- **Validator Type Coverage**: `integer`, `bigint`, `smallint`, `int2/4/8`, `timestamptz`, `numeric(p,s)`, bare `varchar`, `char(n)`, `real`, and `double precision` previously fell through to `z.any()`, so garbage passed validation for those columns. All are now mapped; a genuinely unknown type still falls back to `z.any()` with a one-time warning (throws in 2.0.0). The email enhancement uses `instanceof z.ZodString` instead of the zod-3-only `_def.typeName`
- **`findWhere` Limit/Offset Validation**: non-numeric values produced `LIMIT NaN` (invalid SQL); they now throw `SchemaDefinitionError`. The old truthiness gate also dropped `limit: 0` and `offset: 0`, which are now honored
- **`bulkInsert` Key-Set Mismatch**: records with different column sets failed with an opaque pg-promise error deep in the batch; the mismatch is now detected up front and the error names the offending record index and both column lists
- **Per-Tenant Migrations**: `MigrationManager.ensure()` created `schema_migrations` in `public` regardless of the configured schema, while `currentVersion()` and `applyAll()` read from the target schema — so `applyAll()` failed with `42P01` for any non-public schema. `ensure()` now binds the model to the target schema via `forSchema()`
- **Soft Delete Without Audit Fields**: the constructor no longer skips schema normalization when `hasAuditFields` is false, so `softDelete: true` adds the `deactivated_at` column on its own. Previously every query on such a table failed with `42703 column "deactivated_at" does not exist`. The soft-delete step now lives in its own `addSoftDeleteField` helper, and the caller's schema object is cloned before normalization instead of being mutated

### 🛠 Chores

- **Logging Defers to the Host Logger**: `logMessage` dropped debug output when `NODE_ENV === 'production'`; the library now hands every message to the logger you supply and lets it decide levels
- **Dead Code Removed**: the no-op builtin-function replace loop in `createTableSQL` (both branches returned `match`) and the commented-out `costlines` debug block are gone; the constructor error message no longer claims to check a primary key it never checked
- **Dead Files Removed**: `src/utils/ddlGenerator.js` (a single comment line that shipped in the npm tarball) and the three empty `Examples/` stubs (`db.js`, `models/User.js`, `schemas/userSchema.js`) are deleted; the working examples live under `Examples/migration-tutorial/` and `Examples/pg-schemata-min-example/`

### ⚡ Performance

- **Validator Cache**: pg-promise rebuilds every repository for each task and transaction; Zod validators are now generated once per schema (WeakMap keyed on the schema literal) instead of on every rebuild — previously ~1.9 ms per transaction for 20 repositories

---

## [v1.3.3] - 2026-05-15

### 🐛 Fixes

- **Audit Fields on Insert**: `insert` and `bulkInsert` now auto-fill `updated_by` when audit fields are enabled, matching the behavior of `update`/`bulkUpdate` and `upsert`/`bulkUpsert`

### 🛠 Chores

- **TypeScript Config**: Set `moduleResolution` to `Bundler` in `tsconfig.json`
- **ESLint**: Ignore `docs/.vitepress/dist` and `docs/.vitepress/cache` build output

### 🎨 Style

- Reformat `src/TableModel.js` (no behavior changes)

---

## [v1.3.2] - 2026-05-07

### 🐛 Fixes

- **Cross-Schema Foreign Keys**: `createTableSQL` now honors a target schema on foreign key constraints
  - Add optional `references.schema` to `ConstraintDefinition` for explicit cross-schema FK targets
  - Bare `references.table` falls back to `references.schema` (or the owning schema if absent)
  - Dotted `references.table` (e.g. `'admin.countries'`) still takes precedence when both forms are supplied
  - Constraint-name hash now incorporates `references.schema` when present, preventing collisions for FKs differing only by target schema (existing constraint names unchanged for bare/dotted forms)
  - Multi-dot `references.table` values (e.g. `'a.b.c'`) now throw `SchemaDefinitionError` instead of silently truncating
  - `createTableSQL` accepts `schemaName` as an alias for `dbSchema`, matching `createIndexesSQL`

### 🛠 Chores

- **Dependencies**: Update `@nap-sft/tablsx` to `0.1.3`

---

## [v1.3.1] - 2026-03-14

### 🛠 Refactors

- **Excel Library Migration**: Replace `@nap-sft/xlsxjs` with `tablsx` for spreadsheet read/write functionality

### 📚 Documentation

- **VitePress Migration**: Migrate documentation from MkDocs to VitePress with new guide and reference pages
- **PRD & ADRs**: Add Product Requirements Document with Architecture Decision Records and project rules

---

## [v1.3.0] - 2026-02-13

### 🚀 Features

- **Audit Actor Resolver**: Add configurable `auditActorResolver` callback for dynamic actor injection in CRUD operations
  - Registered via `DB.init()` options to resolve the current actor at query time for `created_by`/`updated_by` audit fields
  - Replaces the need for consumer-side prototype patching
  - Takes priority over the static `_auditUserDefault` fallback

### 🐛 Fixes

- **Upsert Audit Fields**: `upsert` and `bulkUpsert` now include `updated_by` in the `ON CONFLICT SET` clause
- **Soft Delete Audit Fields**: `removeWhere` and `restoreWhere` now set `updated_by` and `updated_at` when audit fields are enabled

### 🧪 Tests

- Add unit tests for `auditActorResolver` module
- Add soft-delete integration tests for audit field behavior
- Update existing TableModel integration and unit tests

---

## [v1.2.3] - 2026-02-02

### 🐛 Fixes

- **Excel Import Path Fix**: Correct `xlsxjs` import to `@nap-sft/xlsxjs` in `QueryModel.exportToSpreadsheet` method, which was missed during v1.2.2 migration

### 📝 Docs

- **Release Guide Updates**: Modernize Git commands from `git checkout` to `git switch` and add PR workflow options throughout the guide

---

## [v1.2.2] - 2026-02-02

### 🛠 Refactors

- **Excel Library Migration**: Replace `exceljs` with `@nap-sft/xlsxjs` for spreadsheet import/export functionality (`07dc564`)
  - Updated import statements in `TableModel.js`
  - Updated test mocks to use the new package name
  - Migrated from `exceljs` to `@nap-sft/xlsxjs` to address dependency concerns with outdated transitive dependencies.

---

## [v1.2.1] - 2026-01-29

### 🚀 Features

- **UNIQUE NULLS NOT DISTINCT Support**: Add PostgreSQL 15+ `NULLS NOT DISTINCT` modifier for unique constraints
  - Treats NULL values as equal for uniqueness purposes (standard behavior treats NULLs as always distinct)
  - Supports both simple array format and new object format for unique constraints
  - New format: `unique: [{ columns: ['tenant_id', 'email'], nullsNotDistinct: true, name: 'custom_name' }]`
  - Optional custom constraint naming via `name` property
  - TypeScript types updated with new `UniqueConstraintDefinition` interface
  - Full backward compatibility with existing array-only format

### 🐛 Fixes

- **Function Call Prefix**: Remove automatic `public.` schema prefix from function calls in default values, allowing PostgreSQL to resolve functions via `search_path`
- **Integration Tests**: Fix error-swallowing try/catch blocks in integration tests that masked actual test failures

### 🧪 Tests

- Add 5 new test cases for `NULLS NOT DISTINCT` covering object format, custom names, mixed formats, and edge cases
- All 250 tests passing

---

## [v1.2.0] - 2026-01-28

### 🚀 Features

- **Configurable Audit Fields**: Add support for object format in `hasAuditFields` to customize user tracking field types
  - Supports configurable PostgreSQL types for `created_by` and `updated_by` columns (e.g., `uuid`, `int`, `varchar`)
  - Maintains full backward compatibility with existing boolean format
  - New format: `hasAuditFields: { enabled: true, userFields: { type: 'uuid', nullable: true, default: null } }`
  - TypeScript types updated with new `AuditFieldsConfig` interface

### 📚 Documentation

- Add comprehensive documentation for new `hasAuditFields` object format in README, getting started guide, and schema types docs
- Add examples demonstrating UUID, integer, and custom type configurations for audit fields

### 🧪 Tests

- Add 11 new test cases for `hasAuditFields` covering object format, backward compatibility, and edge cases
- All 37 `schemaBuilder` tests passing

---

## [v1.1.1] - 2025-09-26

Schema builder now emits clearer logging and supports index generation across schemas, including new coverage for customers.

### 🚀 Features

- Enhance schema builder to surface index creation errors and ensure indexes are generated alongside table creation (`a798d57`)

### 🧪 Tests

- Refactor `schemaBuilder` test suite for readability and add assertions for index creation (`f43cf26`)

---

## [v1.1.0] - 2025-09-23

This release introduces comprehensive migration management and soft delete functionality. See detailed notes in `v1.1.0 Release Notes.md`.

### 🚀 Features

- **Migration Management**: Add full migration support with `SchemaMigrations` model and `MigrationManager` class (`46f29b0`)
- **Migration Tutorial**: Add comprehensive migration tutorial with example schemas and migration scripts (`7e04823`)
- **Soft Delete Enhancement**: Add soft delete checks in `QueryModel` and `TableModel` methods (`3840fc4`)
- **Example Projects**: Initialize pg-schemata-min-example with database connection and user model (`7bd8c86`)
- **Dependency Management**: Add package overrides for exceljs, rimraf, and unzipper dependencies (`e9d4d73`)

### 📚 Documentation

- **Enhanced WHERE Documentation**: Refactor documentation for WHERE clause modifiers with detailed descriptions and examples (`5bbb650`)
- **Improved Readability**: Remove repeated lines and syntax to enhance readability (`7226b72`)
- **Updated Documentation**: Refactor documentation for pg-schemata and schemaTypes (`90e5620`)
- **Changelog Updates**: Update changelog for latest commits and enhancements (`69f4cb9`)

### 🐛 Fixes

- **Installation Instructions**: Update installation command to specify package name (`95acfb8`)
- **Installation Instructions**: Update installation instructions to remove package name (`d7b0150`)

---

## [v1.0.0] - 2025-08-16

This marks the first stable release. See detailed notes in `v1.0.0 Release notes.md`.

### 🚀 Features

- Add `upsert` and `bulkUpsert` methods to `TableModel` with comprehensive tests (`2143fb7`, `f7a8fa1`)
- Add `buildValuesClause` method to generate SQL-safe VALUES clause for bulk data (`03f5215`)
- Add soft delete checks in `QueryModel` and `TableModel` methods to respect `deactivated_at` (`3840fc4`)
- Add initial TypeScript configuration via `tsconfig.json` (`99a4961`, `19bc9db`)
- Enhance `importFromSpreadsheet` to support row transformation via a `callbackFn`
- Add custom Zod validator support in `ColumnDefinition` via `colProps.validator`
- Improve Zod schema generation to respect custom validators
- Add support for generated columns in `createTableSQL` function
- Add support for $is and $not operator in query conditions
- Implement soft delete functionality across models with related methods
- Add Zod-based validation for `insert` and `update` DTOs in `TableModel`
- Add `countWhere` method to `QueryModel` for counting rows with specified conditions
- Enhance `generateZodFromTableSchema` to conditionally set optional enum fields in `insertValidator`
- Enhance `findAfterCursor` to support additional query options and include soft-deleted records
- Add option to include soft-deleted records in `findWhere` method
- Enhance `bulkInsert` and `bulkUpdate` to support optional `RETURNING` clause

### � Refactors

- Change `pgp` and `db` exports to use getter functions for improved encapsulation (`4c53b5d`)
- Streamline `findWhere` method calls in QueryModel integration tests (`ce0e4d9`)
- Enhance test context to drop and recreate schema for cleaner integration tests (`2143fb7`)
- Update count methods in `QueryModel` to use `countWhere` for consistency
- Remove unused `insert` and `exportToSpreadsheet` methods from `TableModel`
- Remove unused parameters from `TableModel` method documentation
- Refactor `exportToSpreadsheet` to directly assign rows from `findWhere`

### 🐛 Fixes

- Streamline `upsert` error handling and enhance `importFromSpreadsheet` to optionally return inserted rows (`ecd8cac`)
- Ensure a primary key is defined in schema for `TableModel` constructor (`050d06f`)
- Remove leftover whitespace and console logs in `TableModel` (`f310cc6`)
- Update error messages in `TableModel` constructor validation (`2143fb7`)
- Add `insert` method back to `TableModel`
- Simplify `bulkInsert` and `bulkUpdate` methods by removing unused options parameter
- Add optional options parameter to `bulkInsert` and `bulkUpdate` for transaction support
- Support optional `RETURNING` clause in `bulkInsert` and `bulkUpdate`
- Correct filtering issues in `countWhere`, `countAll`, and `findSoftDelete` methods
- Update soft delete tests to assert `deactivated_at IS NOT NULL` instead of `!=`
- Fix `$ne: null` condition handling in `QueryModel`
- Standardize `ColumnDefinition` by replacing deprecated `nullable` with `notNull`
- Remove unnecessary debug logging from `QueryModel`, `TableModel`, and `createTable` method
- Correct export for `TableSchema` to support TypeScript ambient context
- Correct file extension for `schemaTypes` in docs script
- Corrected type timestampz to correct postgres type timestamptz
- Standardized handling of `$and`, `$or`, and condition operator normalization
- Fixed default value quoting and schema property access in DDL generation
- Improved integration test structure and database teardown logic
- Streamline SQL generation by removing unnecessary line breaks and improving error messages
- Fix issue in `createTableSQL` to quote unquoted string default values

### 📚 Documentation

- Refactor and clarify schema types and JSDoc comments
- Document `validateDto` method in `TableModel` for DTO validation

### 🧪 Tests

- Add test for `CREATE TABLE` SQL with generated columns
- Add validation tests for `bulkInsert` and `bulkUpdate` methods
- Added unit tests for Zod schema generation
- Added integration tests for `updated_at` Zod coercion
- Adapted tests for updated `findWhere` behavior
- Add unit tests for `columnSetCache` in `schemaBuilder` (`aae5c68`)
- Clear columnSet cache and update schema properties in tests (`5b83d7e`)

### 🧹 Chores

- Remove duplicate entry for `schemaTypes.js` in coverage exclude list

### 📦 Dependencies

- Add `lru-cache` dependency to `package.json` (`500273a`)

---

## [v0.2.0-beta.1] - 2025-06-22

### 🚀 Features

- Implemented `callDb` with schema-aware access to db methods
- Added `exportToSpreadsheet` method to TableModel
- Added Zod validation support to TableModel and schema generator
- Added ZodError handling to TableModel
- Enhanced DB initialization with optional logger and improved logging format
- Enhanced `findWhere` to support aggregation functions (MAX, MIN, SUM)
- Exported `db` and `pgp` from index for external usage
- Implement `logMessage` utility for consistent logging across QueryModel and TableModel (`9ef603f`)
- Introduce `DatabaseError` and `SchemaDefinitionError` classes for better error handling (`660d3ac`)
- Add `setSchemaName` method and improve error handling in `QueryModel` (`e55760d`)
- Implement LRU caching for `ColumnSet` creation to improve performance in `schemaBuilder` (`9e4020e`)
- Add support for `importFromSpreadsheet`, `bulkInsert`, and `bulkUpdate` with transactions
- Introduce `countAll`, `deleteWhere`, `updateWhere` methods to `TableModel` and `QueryModel`
- Support nested logical operators and `$`-prefixed condition keys in `buildCondition`
- Implement cursor-based pagination and enhanced WHERE clause logic
- Support Excel spreadsheet import via `exceljs`
- Add tenant-aware schema testing via `tenant_id` in test harness
- Enable automatic audit fields and default value handling
- Spreadsheet-driven testing and import using structured test files

### 🛠 Refactors

- Improved logging format in QueryModel
- Removed `attachToCallDb` and related tests
- Streamlined index exports
- Refactored `findAll` and `findById` to reuse `findWhere`
- Added column property validation in schemaBuilder
- Consolidated and replaced lodash usage
- Migrated from Jest to Vitest with cleaner test output
- Enhance `logQuery` to include parameters and improve error logging format (`5d08f35`)
- Rename `schema` to `dbSchema` in `schemaBuilder` for consistency (`c7dcd40`)
- Remove internal error handling method from `TableModel` to streamline code (`dd40395`)
- Remove debug logging and standardize property names in `schemaBuilder` (`fb99d36`)
- Renamed `BaseModel` → `TableModel`; removed `ReadOnlyModel` for simplicity
- Modularized and enhanced code clarity in `QueryModel`, `TableModel`, and tests
- Unified schema structure and column handling logic
- Replaced custom `isPlainObject` with lodash implementation
- Rewrote test harness for tenant-awareness and reusable structure

### 🐛 Fixes

- Fixed date coercion bug in Zod validation
- Improved default value handling in `createTableSQL`

### 🧪 Tests

- Added unit tests for Zod schema generation
- Added integration tests for `updated_at` Zod coercion
- Adapted tests for updated `findWhere` behavior
- Add unit tests for `columnSetCache` in `schemaBuilder` (`aae5c68`)
- Clear columnSet cache and update schema properties in tests (`5b83d7e`)

### 📦 Dependencies

- Add `lru-cache` dependency to `package.json` (`500273a`)

### 🐛 Fixes

- Standardized handling of `$and`, `$or`, and condition operator normalization
- Fixed default value quoting and schema property access in DDL generation
- Improved integration test structure and database teardown logic

### 📚 Documentation

- Merged docs branch (squashed)
- Update README with enhanced features and spreadsheet import support (`ee4a01a`)
- Added best practices, design overview, and WHERE clause usage examples
- Improved JSDoc across DB, Model, and Schema utilities

---

## [v0.1.0-beta.1] - 2025-04-17

Initial beta release with:

- Table and column schema definitions via JS object literals
- ColumnSet generation and pg-promise integration
- Base CRUD methods (`insert`, `update`, `delete`)
- DTO sanitization with optional audit fields
- Initial test suite and code documentation

Tagged commit: `v0.1.0-beta.1`
