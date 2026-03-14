# ADR-0005: ESM-Only Module System

**Status:** Accepted
**Date:** 2025-04-17

## Context

Node.js supports CommonJS and ESM. Options:

- **Dual CJS/ESM** — Maximum compatibility but doubles the build/test surface and risks subtle behavioral differences between the two builds.
- **CJS only** — Legacy approach. No top-level await, no tree-shaking.
- **ESM only** — Modern, clean, but excludes CJS consumers who can't use dynamic `import()`.

## Decision

ESM only. The ecosystem is trending this direction, and pg-promise 11.x supports ESM. Maintaining dual builds was not justified for the compatibility gain.

## Consequences

- **Accepted trade-off:** CommonJS consumers must use dynamic `import()`. Requires Node.js >= 16.
- **Benefit:** Aligns with ecosystem direction. Enables top-level await and tree-shaking.
