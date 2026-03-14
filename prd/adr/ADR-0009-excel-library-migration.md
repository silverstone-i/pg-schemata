# ADR-0009: Excel I/O Library Migration (exceljs → xlsxjs → @nap-sft/tablsx)

**Status:** Accepted
**Date:** 2026-02-02 (latest migration), originally 2025-06-22

## Context

pg-schemata supports spreadsheet import/export. The library has been migrated twice:

1. **exceljs** (v0.2.0-beta.1) — Original. Worked but had outdated transitive dependencies (rimraf, unzipper) requiring `overrides` in package.json.
2. **@nap-sft/xlsxjs** (v1.2.2) — Intermediate. Internal package, lighter footprint. Short-lived due to import path issues.
3. **@nap-sft/tablsx** (v1.3.0) — Current. Clean WorkbookReader/WorkbookBuilder API, no problematic transitive dependencies.

## Decision

@nap-sft/tablsx. Each migration was driven by dependency health concerns, not feature gaps.

## Consequences

- **Accepted trade-off:** @nap-sft/tablsx is a newer package with a smaller ecosystem than exceljs.
- **Benefit:** No outdated transitive dependencies, no package overrides needed.
- **Neutral:** Consumer-facing API (`importFromSpreadsheet`, `exportToSpreadsheet`) was unchanged through both migrations.
