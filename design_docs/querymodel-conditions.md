# QueryModel: Supported WHERE Clause Conditions

The `QueryModel` class in `pg-schemata` supports a flexible `findWhere()` method that can build advanced SQL `WHERE` clauses using structured JavaScript objects. This document outlines all currently supported operators and how to use them.

---

## 🔧 Basic Equality

```js
[{ column: value }]
```

### SQL Equivalent:
```sql
WHERE "column" = value
```

---

## ❔ Null Value

```js
[{ column: null }]
```

### SQL Equivalent:
```sql
WHERE "column" IS NULL
```

---

## 🔎 LIKE

```js
[{ column: { like: '%pattern%' } }]
```

### SQL Equivalent:
```sql
WHERE "column" LIKE '%pattern%'
```

---

## 🔍 ILIKE (Case-Insensitive)

```js
[{ column: { ilike: '%pattern%' } }]
```

### SQL Equivalent:
```sql
WHERE "column" ILIKE '%pattern%'
```

---

## 🔢 Range Query

```js
[{ column: { from: '2024-01-01', to: '2024-12-31' } }]
```

### SQL Equivalent:
```sql
WHERE "column" >= '2024-01-01' AND "column" <= '2024-12-31'
```

You may use either `from`, `to`, or both.

---

## 🧮 IN Clause

Supports both `in` and `$in` for flexibility:

```js
[{ column: { in: [1, 2, 3] } }]
[{ column: { $in: ['a', 'b', 'c'] } }]
```

### SQL Equivalent:
```sql
WHERE "column" IN (1, 2, 3)
```

---

## 🔁 Nested AND / OR Groups

```js
[
  {
    or: [
      { column1: 'A' },
      {
        and: [
          { column2: 'B' },
          { column3: 'C' }
        ]
      }
    ]
  }
]
```

### SQL Equivalent:
```sql
WHERE ("column1" = 'A' OR ("column2" = 'B' AND "column3" = 'C'))
```

---

## ⚠️ Unsupported Operators

Only the following keys are supported inside condition objects:
- `like`
- `ilike`
- `from`
- `to`
- `in`
- `$in`

Using unsupported keys will throw:  
```txt
Error: Unsupported operator: <key>
```

---

## 📝 Notes

- The top-level `findWhere()` method accepts an array of conditions.
- These are joined by `AND` by default, but can be changed to `OR` via the second parameter.
- Supports deep nesting of AND/OR.
- Automatically uses parameterized queries to avoid SQL injection.

---

## 🧪 Potential Future Operators

These operators are not currently supported, but may be considered for future implementation:

- `!=` or `not`: for inequality comparisons  
  ```js
  [{ column: { not: value } }]
  // SQL: WHERE "column" != value
  ```

- `>` and `<`: for greater-than / less-than  
  ```js
  [{ column: { gt: 10 } }, { column: { lt: 100 } }]
  // SQL: WHERE "column" > 10 AND "column" < 100
  ```

- `between`: an alternative to `from`/`to`  
  ```js
  [{ column: { between: [min, max] } }]
  // SQL: WHERE "column" BETWEEN min AND max
  ```

- `notIn`: the inverse of the IN clause  
  ```js
  [{ column: { notIn: [1, 2, 3] } }]
  // SQL: WHERE "column" NOT IN (1, 2, 3)
  ```

- `isNull` / `isNotNull`: for explicit null checking  
  ```js
  [{ column: { isNull: true } }, { column: { isNotNull: true } }]
  // SQL: WHERE "column" IS NULL / IS NOT NULL
  ```

Suggestions welcome as use cases evolve.
