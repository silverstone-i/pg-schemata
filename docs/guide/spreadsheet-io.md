# Spreadsheet I/O

pg-schemata can import data from and export data to Excel `.xlsx` files using [tablsx](https://github.com/silverstone-i/tablsx).

## Export to spreadsheet

`exportToSpreadsheet` is available on both `QueryModel` and `TableModel`:

```js
const result = await db().users.exportToSpreadsheet(
  './users-export.xlsx'
);
// { exported: 42, filePath: './users-export.xlsx' }
```

### With filters

```js
const result = await db().users.exportToSpreadsheet(
  './active-admins.xlsx',
  [{ role: 'admin', is_active: true }],  // WHERE conditions
  'AND',                                  // join type
  { orderBy: 'email' }                   // query options
);
```

### Including soft-deleted rows

```js
const result = await db().users.exportToSpreadsheet(
  './all-users.xlsx',
  [],
  'AND',
  { includeDeactivated: true }
);
```

## Import from spreadsheet

`importFromSpreadsheet` is available on `TableModel`:

```js
const result = await db().users.importFromSpreadsheet(
  './users-import.xlsx'
);
// { inserted: { ... } }
```

The first row of the spreadsheet is treated as column headers.

### Selecting a sheet

```js
const result = await db().users.importFromSpreadsheet(
  './data.xlsx',
  1  // sheet index (0-based)
);
```

### Transform callback

Transform each row before insertion with an optional callback:

```js
const result = await db().users.importFromSpreadsheet(
  './users-import.xlsx',
  0,
  async (row) => {
    // Normalize email to lowercase
    row.email = row.email.toLowerCase();
    // Set a default role
    row.role = row.role || 'user';
    return row;
  }
);
```

The callback receives each row as a plain object (column headers as keys) and can modify it before insertion.

### With RETURNING

```js
const result = await db().users.importFromSpreadsheet(
  './users-import.xlsx',
  0,
  null,
  ['id', 'email']  // returning columns
);
```

## How it works

- **Export** uses `findWhere` to query rows, then builds a workbook with `tablsx`'s `WorkbookBuilder` and writes it with `writeXlsx`
- **Import** reads the file with `tablsx`'s `WorkbookReader`, converts rows to objects using the header row, applies the optional transform callback, then calls `bulkInsert`
- All validation, sanitization, and audit field population from `bulkInsert` applies during import
- Soft delete rules apply — imported records cannot include `deactivated_at`
