/*
 * Copyright © 2026 – present NapSoft LLC. All rights reserved.
 */

import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import headers from 'eslint-plugin-headers';
import globals from 'globals';

const copyrightHeader =
  'Copyright © 2026 – present NapSoft LLC. All rights reserved.';

const vitestGlobals = {
  afterAll: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  it: 'readonly',
  test: 'readonly',
  vi: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'node_modules/**',
      'dist/**',
      'pg-schemata-docs/**',
      'Examples/**',
      'docs/.vitepress/dist/**',
      'docs/.vitepress/cache/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...pluginJs.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...(pluginJs.configs.recommended.languageOptions?.globals ?? {}),
        ...globals.node,
      },
    },
  },
  ...tseslint.configs.recommended.map(cfg => ({
    ...cfg,
    files: ['**/*.ts', '**/*.mts'],
  })),
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['tests/**/*.{js,mjs,ts,mts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...vitestGlobals,
      },
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['src/**/*.{js,mjs,ts,mts}', 'tests/**/*.{js,mjs,ts,mts}'],
    plugins: { headers },
    rules: {
      'headers/header-format': [
        'error',
        {
          source: 'string',
          content: copyrightHeader,
          style: 'jsdoc',
          blockPrefix: '\n',
        },
      ],
    },
  },
  prettierConfig
);
