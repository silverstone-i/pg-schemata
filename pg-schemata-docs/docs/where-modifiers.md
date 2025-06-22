# WHERE Clause Modifiers Reference

This guide describes the supported modifiers that can be used in `findWhere`, `updateWhere`, `buildCondition`, and similar methods in pg-schemata's query model.

## 📌 Modifier Reference Table

| Modifier     | Type           | Description                                      | Example                                   |
|--------------|----------------|--------------------------------------------------|-------------------------------------------|
| `$eq`        | any            | Equal to                                         | `{ status: { $eq: 'A' } }`                |
| `$ne`        | any            | Not equal to                                     | `{ status: { $ne: 'X' } }`                |
| `$like`      | string         | SQL `LIKE` pattern                               | `{ name: { $like: 'John%' } }`            |
| `$ilike`     | string         | Case-insensitive `ILIKE` pattern                 | `{ name: { $ilike: '%doe' } }`            |
| `$from`      | comparable     | Greater than or equal                            | `{ date: { $from: '2024-01-01' } }`       |
| `$to`        | comparable     | Less than or equal                               | `{ date: { $to: '2024-12-31' } }`         |
| `$in`        | array          | Matches any value in the list                    | `{ status: { $in: ['A', 'B'] } }`         |
| `$max`       | boolean/true   | Equals maximum value in the table                | `{ score: { $max: true } }`               |
| `$min`       | boolean/true   | Equals minimum value in the table                | `{ value: { $min: true } }`               |
| `$sum`       | boolean/true   | Equals total sum of values in the table          | `{ amount: { $sum: true } }`              |

## 🧠 Usage Example

```js
[
  { status: { $eq: 'active' } },
  { $or: [
      { created_at: { $from: '2024-01-01' } },
      { created_by: { $like: 'admin%' } }
    ]
  }
]
```

## 🔗 See Also

- [QueryModel.buildCondition](pg-schemata.md#buildcondition)
- [QueryModel.findWhere](pg-schemata.md#findWhere)
- [TableModel.updateWhere](pg-schemata.md#updateWhere)
- [pg-schemata.md](pg-schemata.md)
