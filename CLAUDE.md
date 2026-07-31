# CLAUDE.md

Project-level instructions for Claude Code sessions on pg-schemata.

## Branch & PR Rules

- **Solo-developer flow: create a working branch off `main`, do the work, merge back into `main` via PR.** There is no `dev` branch in the flow.
- Pushing a branch has no side effects (safe for syncing between machines). When the work is ready, open the PR deliberately: `gh pr create --base main`.
- Before merging, add exactly one release label to the PR: `release:patch`, `release:minor`, or `release:major`. On merge, CI bumps the version, promotes the CHANGELOG `[Unreleased]` section, tags, and publishes (`release-on-merge.yml`).
- Leave the PR unlabeled for CI/docs-only changes — it merges without a version bump or publish.
- See `prd/rules/release-versioning-process.md` for the full release workflow.

## Commits

- Never include "Co-Authored-By" lines in commit messages.

## npm Publishing

- Never run `npm publish` manually — publishing is CI-driven: merging a release-labeled PR publishes automatically, and manually pushed `vX.Y.Z` / `vX.Y.Z-rc.N` tags trigger `publish-release.yml` / `publish-rc.yml`.
- Never bump the version manually on a working branch — the release workflow does it on `main` after merge, using `--no-git-tag-version`.

## Changelog

- Add changes under the `## [Unreleased]` heading in CHANGELOG.md as part of the work. The release workflow renames that heading to the released version on merge.

## Version Bumps

- PATCH (`release:patch`): bug fixes, dependency updates, documentation fixes, internal refactors with no API changes.
- MINOR (`release:minor`): new features, new exports, new optional parameters.
- MAJOR (`release:major`): removed features, renamed exports, changed behavior, breaking schema changes.
- CI/docs-only changes do not require a version bump or publish — leave the PR unlabeled.
