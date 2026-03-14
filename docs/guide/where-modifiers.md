# WHERE Modifiers

pg-schemata uses plain JavaScript objects to build WHERE clauses. Pass conditions as an array of objects to `findWhere`, `countWhere`, `deleteWhere`, `updateWhere`, and other query methods.

## Basic equality

Pass column names as keys with their expected values:

```js
await db().users.findWhere([{ role: 'admin' }]);
// WHERE "role" = 'admin'

await db().users.findWhere([{ role: 'admin', is_active: true }]);
// WHERE "role" = 'admin' AND "is_active" = true
```

Null values produce `IS NULL`:

```js
await db().users.findWhere([{ last_name: null }]);
// WHERE "last_name" IS NULL
```

## Operators

Use operator objects for more expressive conditions:

### $eq — explicit equality

```js
{ role: { $eq: 'admin' } }
// WHERE "role" = 'admin'
```

### $ne — not equal

```js
{ role: { $ne: 'guest' } }
// WHERE "role" != 'guest'

{ deleted_at: { $ne: null } }
// WHERE "deleted_at" IS NOT NULL
```

### $like / $ilike — pattern matching

```js
{ email: { $like: '%@example.com' } }
// WHERE "email" LIKE '%@example.com'

{ first_name: { $ilike: 'ali%' } }
// WHERE "first_name" ILIKE 'ali%'
```

### $from / $to — range queries

```js
{ created_at: { $from: '2025-01-01', $to: '2025-12-31' } }
// WHERE "created_at" >= '2025-01-01' AND "created_at" <= '2025-12-31'
```

Can be used separately:

```js
{ age: { $from: 18 } }
// WHERE "age" >= 18
```

### $in — array membership

```js
{ role: { $in: ['admin', 'moderator'] } }
// WHERE "role" IN ('admin', 'moderator')
```

The array must be non-empty.

### $is / $not — null checks

```js
{ deleted_at: { $is: null } }
// WHERE "deleted_at" IS NULL

{ deleted_at: { $not: null } }
// WHERE "deleted_at" IS NOT NULL
```

Currently `$is` and `$not` only support `null`.

### $max / $min / $sum — subquery operators

```js
{ score: { $max: true } }
// WHERE "score" = (SELECT MAX("score") FROM "public"."users")

{ score: { $min: true } }
// WHERE "score" = (SELECT MIN("score") FROM "public"."users")
```

## Combining conditions

### Multiple conditions with AND (default)

```js
await db().users.findWhere(
  [{ role: 'admin' }, { is_active: true }],
  'AND'
);
// WHERE "role" = 'admin' AND "is_active" = true
```

### OR conditions

```js
await db().users.findWhere(
  [{ role: 'admin' }, { role: 'moderator' }],
  'OR'
);
// WHERE "role" = 'admin' OR "role" = 'moderator'
```

### Nested boolean logic with $and / $or

```js
await db().users.findWhere([
  {
    $or: [
      { role: 'admin' },
      { $and: [{ role: 'user' }, { is_active: true }] },
    ],
  },
]);
// WHERE ("role" = 'admin' OR ("role" = 'user' AND "is_active" = true))
```

## Combining operators on a single column

Multiple operators can be applied to one column:

```js
{ age: { $from: 18, $to: 65 } }
// WHERE "age" >= 18 AND "age" <= 65

{ email: { $ne: null, $ilike: '%@example.com' } }
// WHERE "email" IS NOT NULL AND "email" ILIKE '%@example.com'
```

## Additional query options

Most query methods accept an options object:

| Option | Type | Description |
|---|---|---|
| `columnWhitelist` | `string[]` | Columns to return (SELECT list) |
| `orderBy` | `string \| string[]` | Sort columns |
| `limit` | `number` | Maximum rows to return |
| `offset` | `number` | Rows to skip |
| `includeDeactivated` | `boolean` | Include soft-deleted rows (default `false`) |
| `filters` | `object` | Additional filter object applied with AND |

```js
await db().users.findWhere(
  [{ is_active: true }],
  'AND',
  {
    columnWhitelist: ['id', 'email', 'first_name'],
    orderBy: 'email',
    limit: 25,
    offset: 0,
  }
);
```
