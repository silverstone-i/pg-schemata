'use strict';

/*
* Copyright © 2024-present, Ian Silverstone
*
* See the LICENSE file at the top-level directory of this distribution
* for licensing information.
*
* Removal or modification of this copyright notice is prohibited.
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
    },
    exclude: ['node_modules', 'dist'],
  },
});
