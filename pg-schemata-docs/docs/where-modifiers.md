# WHERE Clause Modifiers Reference

This guide lists all supported modifiers for `findWhere`, `updateWhere`, and `buildCondition`.

## 📌 Modifier Reference Table

| Modifier      | Type         | Description                               | Example                                            |
| ------------- | ------------ | ----------------------------------------- | -------------------------------------------------- |
| (plain value) | any          | Equals (default)                          | `{ status: 'A' }`                                  |
| (plain null)  | null         | IS NULL                                   | `{ deleted_at: null }`                             |
| `$eq`         | any          | Equal to                                  | `{ status: { $eq: 'A' } }`                         |
| `$ne`         | any or null  | Not equal to (null becomes `IS NOT NULL`) | `{ status: { $ne: 'X' } }`, `{ x: { $ne: null } }` |
| `$like`       | string       | SQL `LIKE` pattern                        | `{ name: { $like: 'John%' } }`                     |
| `$ilike`      | string       | Case-insensitive `ILIKE` pattern          | `{ name: { $ilike: '%doe' } }`                     |
| `$from`       | comparable   | Greater than or equal (`>=`)              | `{ date: { $from: '2024-01-01' } }`                |
| `$to`         | comparable   | Less than or equal (`<=`)                 | `{ date: { $to: '2024-12-31' } }`                  |
| `$in`         | array        | Matches any value in the list             | `{ status: { $in: ['A', 'B'] } }`                  |
| `$is`         | null         | IS NULL (null only)                       | `{ archived_at: { $is: null } }`                   |
| `$not`        | null         | IS NOT NULL (null only)                   | `{ archived_at: { $not: null } }`                  |
| `$max`        | boolean/true | Equals maximum value in the table         | `{ score: { $max: true } }`                        |
| `$min`        | boolean/true | Equals minimum value in the table         | `{ value: { $min: true } }`                        |
| `$sum`        | boolean/true | Equals total sum of values in the table   | `{ amount: { $sum: true } }`                       |

Notes:

- `$gt`, `$gte`, `$lt`, `$lte`, `$between` are not supported; use `$from`/`$to`.
- Unsupported operators throw a `SchemaDefinitionError`.

## 🔀 Boolean group operators

Use nested groups to combine conditions:

- `$and: [...]` or `and: [...]`
- `$or: [...]` or `or: [...]`

Example:

```js
[{ status: 'active' }, { $or: [{ created_at: { $from: '2024-01-01' } }, { created_by: { $like: 'admin%' } }] }];
```

## ❗ Null handling

- Plain `null` becomes `IS NULL`.
- `{ col: { $ne: null } }` and `{ col: { $not: null } }` both become `col IS NOT NULL`.
- `{ col: { $is: null } }` becomes `col IS NULL`.

## ⚠️ Constraints and errors

- `$in` must be a non-empty array; empty arrays throw `SchemaDefinitionError`.
- `$not` and `$is` only accept `null`; any other value throws `SchemaDefinitionError`.
- Any unknown operator key results in `SchemaDefinitionError`.

## 🔗 See Also

- [QueryModel.buildCondition](pg-schemata.md#buildcondition)
- [QueryModel.findWhere](pg-schemata.md#findWhere)
- [TableModel.updateWhere](pg-schemata.md#updateWhere)
- [pg-schemata.md](pg-schemata.md)
