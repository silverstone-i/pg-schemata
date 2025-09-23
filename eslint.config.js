import pluginJs from "@eslint/js";

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  clearImmediate: "readonly",
};

const vitestGlobals = {
  afterAll: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  it: "readonly",
  test: "readonly",
  vi: "readonly",
};

export default [
  {
    ignores: [
      "coverage/**",
      "node_modules/**",
      "pg-schemata-docs/**",
      "Examples/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...pluginJs.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...(pluginJs.configs.recommended.languageOptions?.globals ?? {}),
        ...nodeGlobals,
      },
    },
  },
  {
    files: ["tests/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...nodeGlobals,
        ...vitestGlobals,
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
  {
    files: ["Examples/**/*.js", "Examples/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...nodeGlobals,
      },
    },
  },
];
