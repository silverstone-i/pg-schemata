# Release and Versioning Process

Rules for releasing new versions of pg-schemata.

---

## Versioning

pg-schemata follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

| Type | When | Example |
|------|------|---------|
| PATCH | Bug fixes, dependency updates, documentation fixes | 1.2.1 -> 1.2.2 |
| MINOR | New features, new exports, new optional parameters | 1.2.1 -> 1.3.0 |
| MAJOR | Removed features, renamed exports, changed behavior, breaking schema changes | 1.2.1 -> 2.0.0 |

---

## Branch Flow

```
feature branch -> dev -> release/X.Y.Z (RC) -> main (final) -> back to dev
```

Alternative (simple releases):
```
feature branch -> dev -> main (final) -> back to dev
```

### Branch Roles

| Branch | Purpose |
|--------|---------|
| Feature branches | Active development (e.g., `xlsx`, `fix-auth`) |
| `dev` | Integration branch — features merge here first |
| `release/X.Y.Z` | Release candidate branch for pre-release validation |
| `main` | Production-ready code only |

---

## Pre-Flight Checklist

Before starting any release:

1. Working tree is clean (`git status`)
2. On the correct branch (`git switch dev`)
3. Latest changes pulled (`git pull origin dev`)
4. Dependencies installed (`npm ci`)
5. All tests pass (`npm test`)
6. Linting passes (`npm run lint`)

If any step fails, stop and fix before proceeding.

---

## Version Bump Commands

All version bumps use `--no-git-tag-version` to prevent npm from creating tags automatically.

### Final Releases

| Scenario | Command |
|----------|---------|
| Patch | `npm version patch --no-git-tag-version` |
| Minor | `npm version minor --no-git-tag-version` |
| Major | `npm version major --no-git-tag-version` |
| Explicit | `npm version X.Y.Z --no-git-tag-version` |

### Release Candidates

| Scenario | Command |
|----------|---------|
| First RC (patch) | `npm version prepatch --preid=rc --no-git-tag-version` |
| First RC (minor) | `npm version preminor --preid=rc --no-git-tag-version` |
| First RC (major) | `npm version premajor --preid=rc --no-git-tag-version` |
| Next RC iteration | `npm version prerelease --preid=rc --no-git-tag-version` |

---

## Release Stages

### Feature -> Dev
1. Rebase feature branch onto latest dev
2. Run tests and lint on feature branch
3. Merge into dev (direct or via PR)
4. Push dev, clean up feature branch

### Dev -> RC (when validation needed)
1. Create `release/X.Y.Z` branch from dev
2. Bump to RC version
3. Update CHANGELOG.md
4. Commit: `"chore: bump version to vX.Y.Z-rc.0"`
5. Tag: `vX.Y.Z-rc.0`
6. Push branch and tag
7. Publish to npm with `--tag rc`

### RC -> Final
1. Merge `release/X.Y.Z` into main (direct or via PR)
2. Bump to final version: `npm version X.Y.Z --no-git-tag-version`
3. Commit: `"X.Y.Z"`
4. Tag: `vX.Y.Z`
5. Push main and tag
6. Publish to npm with `--tag latest`
7. Delete release branch

### Dev -> Main (direct, no RC)
1. Merge dev into main
2. Bump version
3. Update CHANGELOG.md
4. Commit: `"X.Y.Z"`
5. Tag: `vX.Y.Z`
6. Push and publish

---

## npm Publishing

### Release Candidate
```bash
npm publish --tag rc
```
Users install RCs explicitly: `npm install pg-schemata@rc`

### Final Release
```bash
npm publish --tag latest
```
This is what users get with `npm install pg-schemata`.

### Verification
```bash
npm view pg-schemata versions --json | tail -5
npm view pg-schemata dist-tags
```

---

## Post-Release

1. Sync dev with main: `git switch dev && git merge --ff-only main && git push origin dev`
2. Update documentation if applicable: `npm run docs`
3. Monitor for issues

---

## Rules

1. Never tag manually without bumping the version in `package.json` first
2. Always update `CHANGELOG.md` with the new version and changes before releasing
3. RC commit messages: `"chore: bump version to vX.Y.Z-rc.N"`
4. Final release commit messages: `"X.Y.Z"` (version number only)
5. Tag format: `vX.Y.Z` (with `v` prefix)
6. Always run the pre-flight checklist before any release
7. After promoting to main, always sync dev back with `--ff-only` (or regular merge if dev has diverged)
8. Never publish directly from a feature branch
9. RC publishes use `--tag rc`; final publishes use `--tag latest`
