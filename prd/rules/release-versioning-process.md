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
feature branch --PR--> dev --PR--> release/X.Y.Z (RC) --PR--> main (final)
                                                                  |
                                                                  v
                                                             sync to dev
```

Alternative (simple releases):
```
feature branch --PR--> dev --PR--> main (final) --> sync to dev
```

Hotfix:
```
main --> hotfix/X.Y.Z --PR--> main --> sync to dev
```

### Branch Roles

| Branch | Purpose |
|--------|---------|
| Feature branches | Active development (e.g., `xlsx`, `fix-auth`) |
| `dev` | Integration branch — features merge here first |
| `release/X.Y.Z` | Release candidate branch for pre-release validation |
| `main` | Production-ready code only |
| `hotfix/X.Y.Z` | Urgent fixes applied directly from main |

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
2. Run tests and lint locally
3. Open PR: `feature/xxx` -> `dev`
   - PR title must follow Conventional Commits
   - Required CI checks must pass
4. Self-approve and merge PR
5. Delete feature branch (auto-deleted by GitHub setting)

### Dev -> RC

1. Cut `release/X.Y.Z` from dev
2. Bump to RC version: `npm version prepatch|preminor|premajor --preid=rc --no-git-tag-version`
3. Update CHANGELOG.md
4. Commit: `"chore: bump version to vX.Y.Z-rc.0"`
5. Create tag: `vX.Y.Z-rc.0`
6. Push branch and tag — CI publishes to npm `--tag rc` automatically
7. Open Draft PR: `release/X.Y.Z` -> `main`

### RC Iteration (if issues found)

1. Fix directly on the `release/X.Y.Z` branch
2. Push fix commits (no publish triggered — no tag)
3. When ready for next RC: `npm version prerelease --preid=rc --no-git-tag-version`
4. Commit: `"chore: bump version to vX.Y.Z-rc.N"`
5. Create tag: `vX.Y.Z-rc.N`
6. Push tag — CI publishes updated RC to npm automatically

### RC -> Final

1. On `release/X.Y.Z` branch: `npm version X.Y.Z --no-git-tag-version`
2. Update CHANGELOG.md (final entry)
3. Commit: `"X.Y.Z"`
4. Mark Draft PR as Ready for Review
5. CI checks pass, self-approve, merge into main
6. Create tag: `vX.Y.Z` on main
7. Push tag — CI publishes to npm `--tag latest` automatically
8. Release branch is auto-deleted by GitHub

### Dev -> Main (simple, no RC)

1. Bump version on dev: `npm version patch|minor|major --no-git-tag-version`
2. Update CHANGELOG.md
3. Commit: `"X.Y.Z"`
4. Open PR: `dev` -> `main`
5. CI checks pass, self-approve, merge
6. Create tag: `vX.Y.Z` on main
7. Push tag — CI publishes to npm `--tag latest` automatically

### Hotfix

1. Cut `hotfix/X.Y.Z` from main (not dev)
2. Apply fix
3. Bump: `npm version patch --no-git-tag-version`
4. Update CHANGELOG.md
5. Commit: `"X.Y.Z"`
6. Open PR: `hotfix/X.Y.Z` -> `main`
   - Push additional fix commits to the same branch if issues are found pre-merge
   - No tags on the hotfix branch — no publish is triggered until after merge
7. CI checks pass, self-approve, merge into main
8. Create tag: `vX.Y.Z` on main
9. Push tag — CI publishes to npm `--tag latest` automatically
10. Sync fix back to dev: `git switch dev && git merge --ff-only main && git push origin dev`

---

## npm Publishing

Publishing is CI-driven via tag push — never run `npm publish` manually.

| Tag pattern | Workflow | npm dist-tag |
|-------------|----------|--------------|
| `vX.Y.Z-rc.N` | `publish-rc.yml` | `rc` |
| `vX.Y.Z` | `publish-release.yml` | `latest` |

Users install RCs explicitly: `npm install pg-schemata@rc`

### Verification
```bash
npm view pg-schemata versions --json | tail -5
npm view pg-schemata dist-tags
```

---

## Post-Release

1. Sync dev with main: `git switch dev && git merge --ff-only main && git push origin dev`
   - If dev has diverged: `git switch dev && git merge main && git push origin dev`
2. Update documentation if applicable: `npm run docs`
3. Monitor for issues

---

## GitHub Repository Settings

These settings must be configured manually in the GitHub repository.

### Branch Protection: `main`

- [ ] Require a pull request before merging
- [ ] Require status checks to pass before merging (require the `CI` workflow)
- [ ] Do not allow bypassing the above settings

### Branch Protection: `dev`

- [ ] Require a pull request before merging
- [ ] Require status checks to pass before merging (require the `CI` workflow)

### General Settings

- [ ] Enable "Automatically delete head branches"

### Secrets

- [ ] `NPM_TOKEN` — npm access token with publish permissions, added to repository secrets

---

## Rules

1. Never tag manually without bumping the version in `package.json` first
2. Always update `CHANGELOG.md` with the new version and changes before releasing
3. RC commit messages: `"chore: bump version to vX.Y.Z-rc.N"`
4. Final release commit messages: `"X.Y.Z"` (version number only)
5. Tag format: `vX.Y.Z` (with `v` prefix)
6. Always run the pre-flight checklist before any release
7. After promoting to main, always sync dev back with `--ff-only` (or regular merge if dev has diverged)
8. Never publish directly from a feature branch or hotfix branch
9. RC publishes use `--tag rc`; final publishes use `--tag latest`
10. Every merge into main must go through a PR with passing CI checks
11. Every merge into dev from a feature branch must go through a PR with passing CI checks
12. Tags are created only after a PR is merged — never on a branch pre-merge (RC tags on release branches are the only exception)
13. npm publishes are CI-driven via tag push — never run `npm publish` manually
