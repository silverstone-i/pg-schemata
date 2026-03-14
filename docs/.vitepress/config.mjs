import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'pg-schemata',
  description: 'A lightweight Postgres-first ORM layer built on pg-promise',
  base: '/pg-schemata/',
  cleanUrls: true,
  themeConfig: {
    logo: '/images/transparent-nap-logo.png',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Examples', link: '/examples/minimal-setup' },
    ],
    search: {
      provider: 'local',
    },
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Schema Definition', link: '/guide/schema-definition' },
            { text: 'Models', link: '/guide/models' },
            { text: 'CRUD Operations', link: '/guide/crud-operations' },
            { text: 'WHERE Modifiers', link: '/guide/where-modifiers' },
            { text: 'Cursor Pagination', link: '/guide/cursor-pagination' },
            { text: 'Soft Delete', link: '/guide/soft-delete' },
            { text: 'Migrations', link: '/guide/migrations' },
            { text: 'Multi-Schema', link: '/guide/multi-schema' },
            { text: 'Audit Fields', link: '/guide/audit-fields' },
            { text: 'Spreadsheet I/O', link: '/guide/spreadsheet-io' },
            { text: 'Error Handling', link: '/guide/error-handling' },
            { text: 'Validation', link: '/guide/validation' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'DB', link: '/reference/db' },
            { text: 'QueryModel', link: '/reference/query-model' },
            { text: 'TableModel', link: '/reference/table-model' },
            { text: 'MigrationManager', link: '/reference/migration-manager' },
            { text: 'Schema Types', link: '/reference/schema-types' },
            { text: 'Utilities', link: '/reference/utilities' },
            { text: 'Errors', link: '/reference/errors' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Minimal Setup', link: '/examples/minimal-setup' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/silverstone-i/pg-schemata' },
    ],
    footer: {
      message: 'A lightweight Postgres-first ORM layer.',
      copyright: 'Copyright 2024-present NapSoft LLC',
    },
  },
});
