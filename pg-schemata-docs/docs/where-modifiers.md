# WHERE Clause Modifiers Reference

This guide lists all modifiers supported by `QueryModel.buildCondition` and how to combine them in `findWhere`, `updateWhere`, and related methods.

## 📌 Field Modifiers

| Modifier | Type              | Description                                          | Example                                                     |
| -------- | ----------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `$eq`    | any               | Equal to                                             | `{ status: { $eq: 'A' } }`                                  |
| `$ne`    | any or null       | Not equal; with `null` becomes `IS NOT NULL`         | `{ status: { $ne: 'X' } }`, `{ deleted_at: { $ne: null } }` |
| `$like`  | string            | SQL `LIKE` pattern                                   | `{ name: { $like: 'John%' } }`                              |
| `$ilike` | string            | Case-insensitive `ILIKE` pattern                     | `{ name: { $ilike: '%doe' } }`                              |
| `$from`  | comparable        | Greater than or equal (`>=`)                         | `{ date: { $from: '2024-01-01' } }`                         |
| `$to`    | comparable        | Less than or equal (`<=`)                            | `{ date: { $to: '2024-12-31' } }`                           |
| `$in`    | array (non-empty) | Matches any value in list                            | `{ status: { $in: ['A', 'B'] } }`                           |
| `$is`    | null only         | `IS NULL` (only supports `null`)                     | `{ archived_at: { $is: null } }`                            |
| `$not`   | null only         | `IS NOT NULL` (only supports `null`)                 | `{ archived_at: { $not: null } }`                           |
| `$max`   | boolean/true      | Equals the maximum value of this column in the table | `{ score: { $max: true } }`                                 |
| `$min`   | boolean/true      | Equals the minimum value of this column in the table | `{ value: { $min: true } }`                                 |
| `$sum`   | boolean/true      | Equals the total sum of this column in the table     | `{ amount: { $sum: true } }`                                |

Notes

- `$is` and `$not` currently only support `null`. Any other operand throws a `SchemaDefinitionError`.
- `$in` must be a non-empty array or a `SchemaDefinitionError` is thrown.

## 🔁 Logical Grouping

Use nested groups to combine conditions:

- `$and`: array of conditions combined with AND
- `$or`: array of conditions combined with OR

Legacy aliases (also supported): `and`, `or`.

Example

```js
[{ $and: [{ status: { $in: ['active', 'pending'] } }, { created_at: { $from: '2024-01-01' } }] }, { $or: [{ name: { $ilike: 'admin%' } }, { email: { $like: '%@example.com' } }] }];
```

## ✅ Defaults and Null Handling

- Plain values imply equality: `{ status: 'active' }` => `status = $1`.
- Plain `null` implies `IS NULL`: `{ deleted_at: null }` => `deleted_at IS NULL`.
- `{ field: { $ne: null } }` and `{ field: { $not: null } }` both result in `field IS NOT NULL`.

## ⚠️ Validation and Errors

- Unknown operators on a field cause `SchemaDefinitionError` (e.g., `{ age: { $gt: 10 } }` is not supported unless listed above).
- `$in` requires a non-empty array.

## 🔗 See Also

- [QueryModel.buildCondition](pg-schemata.md#buildcondition)
- [QueryModel.findWhere](pg-schemata.md#findWhere)
- [TableModel.updateWhere](pg-schemata.md#updateWhere)
- [pg-schemata.md](pg-schemata.md)
