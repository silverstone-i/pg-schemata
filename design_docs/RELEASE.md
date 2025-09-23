# 🔖 Release Process for `pg-schemata`

This document outlines the steps for creating a new release of the `pg-schemata` project, including tagging, publishing to GitHub, and publishing to npm.

> Looking for the prerelease workflow? See `design_docs/RELEASE_CANDIDATE.md` for
> detailed instructions on cutting and distributing RC builds before GA.

---

## ✅ GitHub Release

### 1. Ensure dev is up to date

```bash
git checkout dev
git pull origin dev
```

### 2. Merge dev → main with a release commit

```bash
git checkout main
git pull origin main
git merge --no-ff dev -m "release: v0.x.x"
```

### 3. Bump version if needed

```bash
npm version 0.x.x
```

This:
- Updates `package.json`
- Commits with message `v0.x.x`
- Creates a Git tag

If you want to skip tagging:

```bash
npm version 0.x.x --no-git-tag-version
```

### 4. Push to GitHub

```bash
git push origin main --tags
```

### 5. Create a GitHub release (optional)

Go to: [https://github.com/silverstone-i/pg-schemata/releases](https://github.com/silverstone-i/pg-schemata/releases)

- Click **“Draft a new release”**
- Use tag `v0.x.x`
- Set target as `main`
- Add release notes (copy from CHANGELOG.md)

---

## 📦 npm Publish

### 1. Confirm you're logged in

```bash
npm whoami
```

If not:

```bash
npm login
```

### 2. Publish a stable release

```bash
npm publish
```

### 3. Optional: Publish a beta release

```bash
npm publish --tag beta
```

### 4. Manage dist-tags

```bash
npm dist-tag add pg-schemata@0.x.x latest
npm dist-tag add pg-schemata@0.x.x-beta beta
```

---

## 🌐 GitHub Pages Setup

1. Build your docs using MkDocs or Docusaurus
2. Deploy with:

```bash
mkdocs gh-deploy
```

3. Confirm it’s live at:

```
https://silverstone-i.github.io/pg-schemata/
```

---

## 🔁 Post-release sync

Merge `main` back into `dev` to carry version bump forward:

```bash
git checkout dev
git merge main
git push origin dev
```

---

> Last updated: 2025-06-22
