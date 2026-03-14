# Soft Delete

Soft delete allows you to mark records as inactive without permanently removing them from the database. When enabled, pg-schemata adds a `deactivated_at` column and automatically filters deactivated rows from queries.

## Enabling soft delete

Set `softDelete: true` in your schema:

```js
const schema = {
  dbSchema: 'public',
  table: 'users',
  softDelete: true,
  // ...columns and constraints
};
```

This adds a `deactivated_at` (`timestamptz`) column to the table.

## Soft deleting records

### removeWhere

Sets `deactivated_at = NOW()` on matching rows:

```js
const count = await db().users.removeWhere({ id: userId });
// Marks the row as deactivated

const count = await db().users.removeWhere([
  { role: 'guest' },
  { is_active: false },
]);
// Soft deletes all inactive guests
```

If audit fields are enabled, `updated_by` and `updated_at` are also set.

## Restoring records

### restoreWhere

Clears `deactivated_at` to restore soft-deleted rows:

```js
const count = await db().users.restoreWhere({ id: userId });
```

## Querying soft-deleted records

### findSoftDeleted

Returns only deactivated rows:

```js
const deleted = await db().users.findSoftDeleted();
// All soft-deleted users

const deleted = await db().users.findSoftDeleted(
  [{ role: 'guest' }],
  'AND'
);
// Soft-deleted guests only
```

### isSoftDeleted

Check if a specific record is deactivated:

```js
const isDeleted = await db().users.isSoftDeleted(userId);
// Returns true or false
```

## Including deactivated rows

All query methods exclude deactivated rows by default. Pass `includeDeactivated: true` to include them:

```js
// findWhere
const all = await db().users.findWhere(
  [{ role: 'admin' }],
  'AND',
  { includeDeactivated: true }
);

// findById — use findByIdIncludingDeactivated
const user = await db().users.findByIdIncludingDeactivated(userId);

// countAll
const total = await db().users.countAll({ includeDeactivated: true });
```

## Permanent deletion

### purgeSoftDeleteWhere

Permanently deletes rows that have been soft-deleted and match additional conditions:

```js
// Purge all soft-deleted guests
await db().users.purgeSoftDeleteWhere([{ role: 'guest' }]);

// Purge soft-deleted rows older than 90 days
await db().users.purgeSoftDeleteWhere([
  { deactivated_at: { $to: ninetyDaysAgo } },
]);
```

### purgeSoftDeleteById

Permanently deletes a specific soft-deleted row:

```js
await db().users.purgeSoftDeleteById(userId);
```

Only works on rows that are already soft-deleted (`deactivated_at IS NOT NULL`).

## Behavior with other operations

- `delete(id)` — hard deletes, but only affects non-deactivated rows
- `deleteWhere(where)` — hard deletes, but only affects non-deactivated rows
- `update(id, dto)` — only updates non-deactivated rows
- `insert(dto)` — rejects records that include `deactivated_at` when soft delete is enabled (in bulk operations)
