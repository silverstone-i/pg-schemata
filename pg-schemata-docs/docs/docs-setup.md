---
hide: true
title: Internal Docs Setup
---

# 🛠 Documentation Site Setup

This guide outlines how to generate, sanitize, build, and publish the documentation site for `pg-schemata`.

---

## 📄 JSDoc Annotations

Documentation is generated from JSDoc comments in the codebase using [`documentation.js`](https://github.com/documentationjs/documentation).

---

## 📁 Folder Structure

```
pg-schemata/
├── src/                         # Source code with JSDoc comments
├── pg-schemata-docs/
│   └── documentation/          # Generated .md files
├── docs-site/
│   ├── docs/                   # Sanitized Markdown files for MkDocs
│   ├── mkdocs.yml              # MkDocs site configuration
│   └── ...
```

---

## 📦 Install JS Dependencies

Run the following to install `documentation.js` and related tooling:

```bash
npm install
```

---

## 📜 Build Documentation Files

Use the following script from `package.json` to generate both documentation files and sanitize the output:

```json
"scripts": {
  "docs": "documentation build src/index.js -f md -o pg-schemata-docs/documentation/pg-schemata.md && documentation build src/schemaTypes.js -f md -o pg-schemata-docs/documentation/schemaTypes.md && node ./pg-schemata-docs/sanitizeToc.js"
}
```

Run with:

```bash
npm run docs
```

This generates both documentation files and sanitizes the output using the `sanitizeToc.js` script.

---

## 🐍 Python & MkDocs Setup

1. **Install Python (via Homebrew)**  
   ```bash
   brew install python
   ```

2. **Create Virtual Environment**  
   ```bash
   python3 -m venv venv
   ```

3. **Activate Environment**  
   ```bash
   source venv/bin/activate
   ```

4. **Install MkDocs and Plugins**  
   ```bash
   pip install mkdocs mkdocs-material mkdocs-material-extensions==1.3.1
   ```

---

## 🧼 Sanitize Markdown Files

Run this script to sanitize and format documentation output:

```bash
node sanitizeDocs.js
```

This script:
- Inserts frontmatter
- Escapes MDX-sensitive syntax
- Normalizes formatting

---

## 🛠 Build & Preview MkDocs Site

From inside the `docs-site/` folder:

```bash
mkdocs serve
```

To build static site output:

```bash
mkdocs build
```

---

## 🚀 Publish to GitHub Pages

To publish built site:

```bash
mkdocs gh-deploy
```

This pushes the site to the `gh-pages` branch of your repository and makes it live.

---

## ✅ Requirements Summary

- Node.js v18+
- Python 3.10+
- documentation.js
- MkDocs Material theme v9.6.14+
- mkdocs-material-extensions v1.3.1+