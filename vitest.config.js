/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // include: ['tests/integration/**/*.test.js'],
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
        'vitest.config.js',
        'src/index.js',
        'tests/**',
        'src/tableSchema.js',
        'src/schemaTypes.d.ts',
        'src/types-ref.js',
      ],
    },
    exclude: ['node_modules', 'dist'],
  },
});
