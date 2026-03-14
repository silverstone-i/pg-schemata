# Cursor Pagination

`findAfterCursor` implements keyset-based pagination, which is more efficient than offset-based pagination for large datasets.

## Basic usage

```js
// First page
const page1 = await db().users.findAfterCursor(
  {},     // no cursor for the first page
  25,     // limit
  ['id']  // orderBy columns
);
// Returns { rows: [...], nextCursor: { id: 'last-id-value' } | null }

// Next page
const page2 = await db().users.findAfterCursor(
  page1.nextCursor,  // pass the cursor from the previous result
  25,
  ['id']
);
```

When there are no more rows, `nextCursor` is `null`.

## Multi-column cursors

Paginate by multiple columns for deterministic ordering:

```js
const page = await db().users.findAfterCursor(
  {},
  25,
  ['last_name', 'id']
);
// Cursor: { last_name: 'Smith', id: 'abc-123' }
```

The cursor object must contain a value for every column in `orderBy`.

## Descending order

```js
const page = await db().users.findAfterCursor(
  {},
  25,
  ['created_at'],
  { descending: true }
);
```

## Filtering

Apply filters alongside cursor pagination:

```js
const page = await db().users.findAfterCursor(
  {},
  25,
  ['id'],
  {
    filters: { is_active: true, role: 'admin' },
    columnWhitelist: ['id', 'email', 'first_name'],
  }
);
```

Filters support nested `and` / `or` logic:

```js
const page = await db().users.findAfterCursor(
  {},
  25,
  ['id'],
  {
    filters: {
      and: [{ is_active: true }, { role: { $in: ['admin', 'moderator'] } }],
    },
  }
);
```

## Soft delete awareness

When soft delete is enabled, deactivated rows are automatically excluded unless you pass `includeDeactivated: true`:

```js
const page = await db().users.findAfterCursor(
  {},
  25,
  ['id'],
  { includeDeactivated: true }
);
```

## Iterating all pages

```js
let cursor = {};
let allRows = [];

while (true) {
  const { rows, nextCursor } = await db().users.findAfterCursor(cursor, 100, ['id']);
  allRows.push(...rows);
  if (!nextCursor) break;
  cursor = nextCursor;
}
```
