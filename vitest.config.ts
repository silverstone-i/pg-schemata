/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    isolate: true,
    sequence: {
      concurrent: false,
    },
    coverage: {
      reporter: ['text', 'html'],
      exclude: [
        'Examples/**',
        'pg-schemata-docs/**',
        'node_modules/**',
        'dist/**',
        'vitest.config.ts',
        'src/index.ts',
        'tests/**',
        'src/tableSchema.ts',
        'src/schemaTypes.ts',
        'src/types/**',
      ],
    },
    exclude: ['node_modules', 'dist'],
  },
});
