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
  ...[
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
  ].map(cfg => ({
    ...cfg,
    files: ['**/*.ts', '**/*.mts'],
  })),
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The migration must be behavior-identical: several `||` fallbacks are
      // load-bearing for empty strings ('' must fall through), which `??`
      // would change.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
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
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
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
