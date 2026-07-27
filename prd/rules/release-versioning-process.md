# Release and Versioning Process

Rules for releasing new versions of pg-schemata.

pg-schemata is developed solo: work happens on short-lived branches cut from `main` and merges straight back into `main`. Releases are automated — the release label on the PR decides the version bump, and CI does the rest.

---

## Versioning

pg-schemata follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

| Type | Label | When | Example |
|------|-------|------|---------|
| PATCH | `release:patch` | Bug fixes, dependency updates, documentation fixes | 1.2.1 -> 1.2.2 |
| MINOR | `release:minor` | New features, new exports, new optional parameters | 1.2.1 -> 1.3.0 |
| MAJOR | `release:major` | Removed features, renamed exports, changed behavior, breaking schema changes | 1.2.1 -> 2.0.0 |
| none | (no label) | CI or docs-only changes — merge without releasing | — |

---

## Branch Flow

```
main --> working branch --PR (labeled)--> main --> CI bumps version, tags, publishes
```

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code; every release is cut from here |
| Working branches | All development — features, fixes, refactors, hotfixes (e.g., `fix-auth`, `forSchema`) |

A hotfix is just a working branch with a `release:patch` label; it needs no special flow.

---

## The Release Cycle

1. **Branch**: `git switch main && git pull && git switch -c <branch-name>`
2. **Work**: implement, add tests, record changes under `## [Unreleased]` in CHANGELOG.md.
3. **Push**: `auto-pr.yml` opens a PR to `main` automatically if one is not already open.
4. **Label**: add exactly one release label (`release:patch` / `release:minor` / `release:major`), or none for CI/docs-only changes.
5. **Merge**: once CI is green, self-approve and merge. The branch is auto-deleted.
6. **CI releases** (`release-on-merge.yml`): on merge of a labeled PR it
   - runs unit tests and lint on `main`,
   - bumps the version (`npm version <type> --no-git-tag-version`),
   - renames `## [Unreleased]` in CHANGELOG.md to the new version with today's date,
   - commits `X.Y.Z` to `main` and tags `vX.Y.Z`,
   - publishes to npm with `--tag latest`.

An unlabeled PR stops after step 5 — no bump, no tag, no publish.

### Pre-Flight Checklist (before merging)

1. CI green on the PR (unit + integration + lint)
2. CHANGELOG.md `[Unreleased]` section describes the change
3. Correct release label applied (or deliberately none)

---

## Release Candidates (manual, optional)

For changes that need validation in a consuming app before going `latest`, publish an RC from the working branch by hand:

1. `npm version prepatch|preminor|premajor --preid=rc --no-git-tag-version` (first RC) or `npm version prerelease --preid=rc --no-git-tag-version` (next iteration)
2. Commit `"chore: bump version to vX.Y.Z-rc.N"`
3. `git tag vX.Y.Z-rc.N && git push origin vX.Y.Z-rc.N` — `publish-rc.yml` publishes to npm `--tag rc`
4. Consumers install with `npm install pg-schemata@rc`
5. Before merging the PR, reset the version in package.json back to the current released version so the automated bump lands on the right number.

---

## npm Publishing

Publishing is CI-driven — never run `npm publish` manually.

| Trigger | Workflow | npm dist-tag |
|---------|----------|--------------|
| Merge of a release-labeled PR into `main` | `release-on-merge.yml` | `latest` |
| Manually pushed `vX.Y.Z` tag | `publish-release.yml` | `latest` |
| Manually pushed `vX.Y.Z-rc.N` tag | `publish-rc.yml` | `rc` |

The tag created by `release-on-merge.yml` is pushed with `GITHUB_TOKEN`, which deliberately does not trigger `publish-release.yml` — that workflow remains as the path for manually pushed tags, and there is no double publish.

The bump type is aggregated across all PRs merged since the last release tag (highest label wins), so releases queued behind one another never lose a bump level.

**Fork PRs**: `pull_request` workflows from forks do not receive repository secrets, so merging a fork-based PR cannot publish — the merge succeeds and the publish step fails. Release such changes by pushing the `vX.Y.Z` tag manually (`publish-release.yml` handles it), or by merging a labeled follow-up PR from a local branch.

### Verification

```bash
npm view pg-schemata versions --json | tail -5
npm view pg-schemata dist-tags
```

---

## Post-Release

1. Confirm the new version and tag: `git fetch --tags && git log --oneline -2 origin/main`
2. Docs deploy automatically on push to `main` (`docs.yml`)
3. Monitor for issues; a fix is a new working branch with `release:patch`

---

## GitHub Repository Settings

These settings must be configured manually in the GitHub repository.

### Labels

Create once:

```bash
gh label create release:patch --color 0e8a16 --description "Bug fixes, docs, internal refactors"
gh label create release:minor --color 1d76db --description "New features, new exports, new optional parameters"
gh label create release:major --color b60205 --description "Breaking changes"
```

### Branch Protection: `main`

- [ ] Require a pull request before merging
- [ ] Require status checks to pass before merging (require the `CI` workflow)
- [ ] Allow `github-actions[bot]` to bypass (via a ruleset bypass entry) — the release workflow pushes the version-bump commit and tag directly to `main`

### General

- [ ] Auto-delete head branches after merge
