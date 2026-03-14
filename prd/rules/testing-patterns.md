# Testing Patterns

Rules for writing and organizing tests in pg-schemata.

---

## Test Framework

- **Framework**: Vitest (v3.x)
- **Config**: `vitest.config.js`
- **Environment**: Node.js (`environment: 'node'`)
- **Concurrency**: Sequential (`concurrent: false`) — prevents database conflicts in integration tests
- **Coverage**: `@vitest/coverage-v8`

---

## Directory Structure

```
tests/
├── unit/                    # Unit tests (mocked dependencies)
│   ├── TableModel.test.js
│   ├── QueryModel.test.js
│   ├── TableModel.softDelete.test.js
│   ├── auditActorResolver.test.js
│   ├── generateZodValidator.test.js
│   ├── schemaBuilder.test.js
│   └── ...
├── integration/             # Integration tests (real PostgreSQL)
│   ├── pg-schemata.integration.test.js
│   └── ...
└── helpers/
    ├── integrationHarness.js    # Test setup/teardown for integration tests
    └── testUserSchema.js        # Shared test schema definition
```

---

## File Naming

`[Module].[type].test.js`

- `Module`: The source module being tested (e.g., `TableModel`, `QueryModel`, `schemaBuilder`)
- `type` (optional): Test focus area (e.g., `softDelete`, `integration`)
- Extension: Always `.test.js`

Examples:
- `TableModel.test.js` — Unit tests for TableModel
- `TableModel.softDelete.test.js` — Unit tests focused on soft delete
- `pg-schemata.integration.test.js` — Integration tests

---

## Unit Tests

Unit tests mock the `db` and `pgp` dependencies to test logic in isolation.

### Mocking Pattern

```javascript
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the database methods
const mockDb = {
  any: vi.fn(),
  one: vi.fn(),
  oneOrNone: vi.fn(),
  none: vi.fn(),
  result: vi.fn(),
  tx: vi.fn(cb => cb(mockDb)),
};

const mockPgp = {
  helpers: {
    insert: vi.fn(),
    update: vi.fn(),
    ColumnSet: vi.fn(),
  },
  as: { format: vi.fn() },
};
```

### Rules for Unit Tests

1. Mock all database calls — unit tests must not require a running PostgreSQL instance
2. Test one behavior per test case
3. Clear mocks between tests using `beforeEach(() => vi.clearAllMocks())`
4. Clear the ColumnSet cache when testing schema builder functions

---

## Integration Tests

Integration tests use a real PostgreSQL database via the integration harness.

### Harness (`tests/helpers/integrationHarness.js`)

The harness provides:
- Database connection setup using environment variables (`.env`)
- Schema creation and teardown (drops and recreates test schema)
- Table creation for test schemas
- Shared test context with `db` and `pgp` instances

### Rules for Integration Tests

1. Always use the integration harness for setup/teardown
2. Each test file should clean up its test data (use transactions or delete statements)
3. Do not use try/catch blocks that swallow assertion errors — let test failures propagate
4. Integration tests run sequentially to prevent database state conflicts
5. Use a dedicated test schema (not `public`) to avoid interfering with other data

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm test` | `vitest run` | Run all tests |
| `npm run test:unit` | `vitest run tests/unit` | Unit tests only |
| `npm run test:integration` | `vitest run tests/integration` | Integration tests only |
| `npm run test:watch` | `vitest` | Watch mode |
| `npm run test:coverage` | `vitest run --coverage` | Generate coverage report |

---

## Coverage

- Provider: `@vitest/coverage-v8`
- Excluded from coverage: `Examples/`, `docs/`, `src/schemaTypes.d.ts`, `src/types-ref.js`
- Coverage reports are generated in the default `coverage/` directory

---

## General Rules

1. All new features must include unit tests
2. CRUD operations and query behavior changes should include integration tests
3. Test descriptions should be clear and descriptive: `it('should throw SchemaDefinitionError when primary key is missing')`
4. Use `describe` blocks to group related tests by method or feature
5. Prefer `expect(...).toEqual()` for value comparisons and `expect(...).toThrow()` for error assertions
6. Do not introduce `console.log` statements in tests — use the logger mock or vitest's built-in output
