# CLAUDE.md

Project-level instructions for Claude Code sessions on pg-schemata.

## Branch & PR Rules

- **Feature branches and refactor branches always merge into `dev` via PR — never directly into `main`.**
- Only `release/X.Y.Z`, `hotfix/X.Y.Z`, and `dev` branches merge into `main` via PR.
- See `prd/rules/release-versioning-process.md` for the full release workflow.

## Commits

- Never include "Co-Authored-By" lines in commit messages.

## npm Publishing

- Never run `npm publish` manually — publishing is CI-driven via git tag push.
- All version bumps use `--no-git-tag-version`. Tags are created manually with `git tag`.

## Version Bumps

- PATCH: bug fixes, dependency updates, documentation fixes, internal refactors with no API changes.
- MINOR: new features, new exports, new optional parameters.
- MAJOR: removed features, renamed exports, changed behavior, breaking schema changes.
- CI/docs-only changes do not require a version bump or publish.
