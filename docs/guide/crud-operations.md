# CRUD Operations

`TableModel` provides a complete set of create, read, update, and delete methods. All write methods automatically validate DTOs, sanitize input to valid columns, populate audit fields, and respect soft delete rules.

## Insert

```js
const user = await db().users.insert({
  email: 'alice@example.com',
  first_name: 'Alice',
  role: 'admin',
});
// Returns the full inserted row (RETURNING *)
```

- Validates the DTO against the auto-generated Zod insert validator
- Strips unknown columns via `sanitizeDto()`
- Sets `created_by` from the audit actor resolver (if audit fields enabled)
- Immutable columns are included in inserts

## Update

```js
const updated = await db().users.update(user.id, {
  last_name: 'Liddell',
});
// Returns the updated row, or null if not found
```

- Validates the DTO against the update validator
- Immutable columns are excluded from updates
- Sets `updated_by` from the audit actor resolver
- When soft delete is enabled, only updates non-deactivated rows

## Delete

```js
const rowCount = await db().users.delete(user.id);
```

- Hard deletes the row by primary key
- When soft delete is enabled, only deletes non-deactivated rows
- Returns the number of rows deleted

## Upsert

Insert a row or update it on conflict:

```js
const result = await db().users.upsert(
  { email: 'alice@example.com', first_name: 'Alice', role: 'admin' },
  ['email'],           // conflict columns
  ['first_name', 'role']  // columns to update on conflict (optional)
);
```

- Uses `INSERT ... ON CONFLICT ... DO UPDATE SET`
- If `updateColumns` is omitted, all non-conflict, non-id columns are updated
- Audit fields are handled automatically — `created_by` / `updated_by` are set

## Conditional mutations

### deleteWhere

```js
const count = await db().users.deleteWhere([
  { is_active: false },
  { role: 'guest' },
]);
```

### updateWhere

```js
const count = await db().users.updateWhere(
  [{ role: 'guest' }],          // WHERE conditions
  { is_active: false },         // SET values
  { includeDeactivated: false } // options
);
```

### touch

Update only the `updated_at` timestamp:

```js
await db().users.touch(user.id);
// Or with an explicit actor:
await db().users.touch(user.id, 'admin-user');
```

## Bulk operations

### bulkInsert

```js
const rowCount = await db().users.bulkInsert([
  { email: 'bob@example.com', first_name: 'Bob' },
  { email: 'carol@example.com', first_name: 'Carol' },
]);
// Returns the number of rows inserted
```

With `RETURNING`:

```js
const rows = await db().users.bulkInsert(
  [
    { email: 'bob@example.com', first_name: 'Bob' },
    { email: 'carol@example.com', first_name: 'Carol' },
  ],
  ['id', 'email']  // columns to return
);
// Returns array of { id, email } objects
```

### bulkUpdate

```js
const results = await db().users.bulkUpdate([
  { id: user1.id, role: 'admin' },
  { id: user2.id, role: 'moderator' },
]);
```

- Each record must include an `id` field
- Runs all updates in a transaction via `pg-promise.tx.batch()`
- Returns an array of row counts (or rows if `returning` is specified)

### bulkUpsert

```js
const rowCount = await db().users.bulkUpsert(
  records,
  ['email'],              // conflict columns
  ['first_name', 'role'], // update columns (optional)
  ['id', 'email']         // returning columns (optional)
);
```

## Schema management

### createTable

Generate and execute the `CREATE TABLE` SQL from your schema definition:

```js
await db().users.createTable();
```

Creates the table with all columns, constraints, and indexes defined in your schema.

### truncate

```js
await db().users.truncate();
```

Runs `TRUNCATE TABLE ... RESTART IDENTITY CASCADE`.
