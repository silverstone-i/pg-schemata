# pg-schemata Release Guide (For Dummies)

This playbook walks you through the complete release process for pg-schemata.
Every step is spelled out with explanations so you always know *why* you are typing a command.

---

## Table of Contents

1. [Big Picture](#1-big-picture)
2. [Versioning](#2-versioning)
3. [Pre-flight Checklist](#3-pre-flight-checklist)
4. [Release Stages](#4-release-stages)
   - [4.1 Merging a Feature Branch into Dev](#41-merging-a-feature-branch-into-dev)
   - [4.2 Release Candidate Workflow](#42-release-candidate-workflow)
   - [4.3 Promoting RC to Final Release](#43-promoting-rc-to-final-release)
   - [4.4 Direct Release from Dev (No RC)](#44-direct-release-from-dev-no-rc)
5. [Publishing to npm](#5-publishing-to-npm)
   - [5.1 Publishing a Release Candidate](#51-publishing-a-release-candidate)
   - [5.2 Publishing a Final Release](#52-publishing-a-final-release)
6. [Post-Release Tasks](#6-post-release-tasks)
7. [Quick Reference](#7-quick-reference)

---

## 1. Big Picture

The typical release flow:

```
feature branch → dev → release/X.Y.Z (RC) → main (final) → back to dev
```

Alternative direct release flow (for simple releases):

```
feature branch → dev → main (final) → back to dev
```

Key branches:
- **Feature branches** (e.g., `xlsx`, `fix-auth`): Where development happens
- **`dev`**: Integration branch where features are merged and tested together
- **`release/X.Y.Z`**: Release candidate branch for pre-release testing
- **`main`**: Production-ready code only

---

## 2. Versioning

pg-schemata follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (incompatible API changes)
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### 2.1 Version Bump Commands

All commands use `--no-git-tag-version` to prevent npm from creating tags automatically (you'll tag manually after review).

#### Final Release Versions

| Release Type | Command | Example |
|--------------|---------|---------|
| Patch (bug fix) | `npm version patch --no-git-tag-version` | 1.2.1 → 1.2.2 |
| Minor (new feature) | `npm version minor --no-git-tag-version` | 1.2.1 → 1.3.0 |
| Major (breaking) | `npm version major --no-git-tag-version` | 1.2.1 → 2.0.0 |
| Explicit version | `npm version 1.2.2 --no-git-tag-version` | → 1.2.2 |

#### Release Candidate Versions

| Release Type | Command | Example |
|--------------|---------|---------|
| Patch RC | `npm version prepatch --preid=rc --no-git-tag-version` | 1.2.1 → 1.2.2-rc.0 |
| Minor RC | `npm version preminor --preid=rc --no-git-tag-version` | 1.2.1 → 1.3.0-rc.0 |
| Major RC | `npm version premajor --preid=rc --no-git-tag-version` | 1.2.1 → 2.0.0-rc.0 |
| Bump RC number | `npm version prerelease --preid=rc --no-git-tag-version` | 1.2.2-rc.0 → 1.2.2-rc.1 |

### 2.2 Checking the Current Version

```bash
node -p "require('./package.json').version"
```

### 2.3 When to Use Each Version Type

- **Patch**: Bug fixes, dependency updates, documentation fixes
- **Minor**: New features, new exports, new optional parameters
- **Major**: Removed features, renamed exports, changed behavior, breaking schema changes

---

## 3. Pre-flight Checklist

Run these commands before starting any release process:

```bash
git status                  # Confirm working tree is clean
git checkout dev            # Switch to dev branch (or your starting branch)
git pull origin dev         # Pull latest changes
npm ci                      # Install exact dependency versions
npm test                    # Run automated tests
npm run lint                # Check code style (if available)
```

If any step fails, stop and fix it before proceeding.

---

## 4. Release Stages

### 4.1 Merging a Feature Branch into Dev

When your feature branch is ready to be integrated:

#### Step 1: Ensure your feature branch is up to date

```bash
git checkout dev
git pull origin dev
git checkout <feature-branch>     # e.g., git checkout xlsx
git rebase dev                    # Rebase onto latest dev (or merge if preferred)
```

#### Step 2: Run tests on your feature branch

```bash
npm ci
npm test
npm run lint
```

#### Step 3: Merge into dev

```bash
git checkout dev
git merge <feature-branch>        # e.g., git merge xlsx
```

#### Step 4: Push and clean up

```bash
git push origin dev
git branch -d <feature-branch>    # Delete local feature branch
git push origin --delete <feature-branch>  # Delete remote feature branch (optional)
```

---

### 4.2 Release Candidate Workflow

Use this workflow when you want to validate before the final release.

#### Step 1: Create the release branch from dev

```bash
git checkout dev
git pull origin dev
git checkout -b release/X.Y.Z     # e.g., release/1.2.2
```

#### Step 2: Bump to RC version

Choose the appropriate command based on your release type:

```bash
# For a patch release candidate:
npm version prepatch --preid=rc --no-git-tag-version

# For a minor release candidate:
npm version preminor --preid=rc --no-git-tag-version

# For a major release candidate:
npm version premajor --preid=rc --no-git-tag-version
```

#### Step 3: Update documentation

- Update `CHANGELOG.md` with the new version and changes
- Update any release notes or migration guides

#### Step 4: Commit, tag, and push

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: bump version to vX.Y.Z-rc.0"
git tag vX.Y.Z-rc.0
git push --set-upstream origin release/X.Y.Z
git push origin vX.Y.Z-rc.0
```

#### Step 5: Publish RC to npm

See [5.1 Publishing a Release Candidate](#51-publishing-a-release-candidate).

#### Step 6: Test the RC

- Install and test the RC in a separate project
- Run any manual validation needed

#### Step 7: If issues are found, iterate

```bash
# Fix issues on the release branch
git checkout release/X.Y.Z
# ... make fixes ...
npm version prerelease --preid=rc --no-git-tag-version  # Bumps rc.0 → rc.1
git add -A
git commit -m "fix: description of fix"
git tag vX.Y.Z-rc.1
git push origin release/X.Y.Z
git push origin vX.Y.Z-rc.1
npm publish --tag rc
```

---

### 4.3 Promoting RC to Final Release

After the RC has been validated:

#### Step 1: Merge release branch into main

```bash
git checkout main
git pull origin main
git merge release/X.Y.Z
```

#### Step 2: Bump to final version

```bash
npm version X.Y.Z --no-git-tag-version   # Removes the -rc.N suffix
```

Or use the appropriate command:

```bash
npm version patch --no-git-tag-version   # If coming from X.Y.Z-rc.N
```

#### Step 3: Commit and tag

```bash
git add package.json package-lock.json
git commit -m "X.Y.Z"
git tag vX.Y.Z
```

#### Step 4: Push and publish

```bash
git push origin main
git push origin vX.Y.Z
```

See [5.2 Publishing a Final Release](#52-publishing-a-final-release).

#### Step 5: Clean up release branch

```bash
git branch -d release/X.Y.Z
git push origin --delete release/X.Y.Z
```

---

### 4.4 Direct Release from Dev (No RC)

Use this workflow for simple, low-risk releases (small bug fixes, documentation updates).

#### Step 1: Ensure dev is ready

```bash
git checkout dev
git pull origin dev
npm ci
npm test
npm run lint
```

#### Step 2: Merge dev into main

```bash
git checkout main
git pull origin main
git merge dev
```

#### Step 3: Bump version

```bash
npm version patch --no-git-tag-version   # or minor/major as appropriate
```

#### Step 4: Update changelog and commit

```bash
# Update CHANGELOG.md with the new version (if not already done)
git add package.json package-lock.json CHANGELOG.md
git commit -m "X.Y.Z"
git tag vX.Y.Z
```

#### Step 5: Push and publish

```bash
git push origin main
git push origin vX.Y.Z
```

See [5.2 Publishing a Final Release](#52-publishing-a-final-release).

---

## 5. Publishing to npm

### 5.1 Publishing a Release Candidate

#### Verify you're logged in

```bash
npm whoami
```

If not logged in, run `npm login` and follow the prompts.

#### Publish with the `rc` tag

```bash
npm publish --tag rc
```

The `--tag rc` flag ensures users must explicitly request the RC:

```bash
npm install pg-schemata@rc           # Install latest RC
npm install pg-schemata@1.2.2-rc.0   # Install specific RC
```

#### Verify the publication

```bash
npm view pg-schemata versions --json | tail -5
npm view pg-schemata dist-tags
```

#### (Optional) Create GitHub pre-release

1. Go to Releases → Draft a new release
2. Select the RC tag (e.g., `v1.2.2-rc.0`)
3. Check "This is a pre-release"
4. Publish

---

### 5.2 Publishing a Final Release

#### Verify you're logged in

```bash
npm whoami
```

#### Publish with the `latest` tag

```bash
npm publish --tag latest
```

This is the default tag, so `npm publish` alone also works. The `latest` tag is what users get when they run `npm install pg-schemata`.

#### Verify the publication

```bash
npm view pg-schemata versions --json | tail -5
npm view pg-schemata dist-tags
```

Expected output:

```
{ latest: 'X.Y.Z', rc: 'X.Y.Z-rc.N' }
```

#### Clean up dist-tags (if needed)

```bash
# Move latest tag if needed
npm dist-tag add pg-schemata@X.Y.Z latest

# Remove old rc tag (optional)
npm dist-tag rm pg-schemata rc
```

#### (Optional) Create GitHub release

1. Go to Releases → Draft a new release
2. Select the final tag (e.g., `v1.2.2`)
3. Target: `main`
4. Paste release notes from `CHANGELOG.md`
5. Do NOT check "This is a pre-release"
6. Publish

---

## 6. Post-Release Tasks

### 6.1 Sync dev with main

```bash
git checkout dev
git pull origin dev
git merge --ff-only main    # Fast-forward dev to include release
git push origin dev
```

If fast-forward fails (dev has new commits), use a regular merge:

```bash
git merge main
git push origin dev
```

### 6.2 Update documentation (if applicable)

```bash
npm run docs                # If project has doc generation
mkdocs gh-deploy            # If using MkDocs for GitHub Pages
```

### 6.3 Monitor and announce

- Announce the release internally/externally
- Watch error tracking and support channels
- File follow-up issues for anything postponed

---

## 7. Quick Reference

### Starting a release from a feature branch

```bash
# You're on feature branch (e.g., xlsx) and ready to release
git checkout dev && git pull origin dev
git merge <feature-branch>
git push origin dev

# Option A: Direct release (no RC)
git checkout main && git pull origin main
git merge dev
npm version patch --no-git-tag-version
# Update CHANGELOG.md if needed
git add -A && git commit -m "X.Y.Z"
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
npm publish --tag latest

# Option B: Release candidate first
git checkout -b release/X.Y.Z
npm version prepatch --preid=rc --no-git-tag-version
# Update CHANGELOG.md
git add -A && git commit -m "chore: bump version to vX.Y.Z-rc.0"
git tag vX.Y.Z-rc.0
git push --set-upstream origin release/X.Y.Z
git push origin vX.Y.Z-rc.0
npm publish --tag rc
# ... test, then promote to final (see section 4.3) ...
```

### Version bump cheat sheet

| Scenario | Command |
|----------|---------|
| Bug fix release | `npm version patch --no-git-tag-version` |
| New feature release | `npm version minor --no-git-tag-version` |
| Breaking change release | `npm version major --no-git-tag-version` |
| First RC for patch | `npm version prepatch --preid=rc --no-git-tag-version` |
| First RC for minor | `npm version preminor --preid=rc --no-git-tag-version` |
| First RC for major | `npm version premajor --preid=rc --no-git-tag-version` |
| Next RC iteration | `npm version prerelease --preid=rc --no-git-tag-version` |
| RC to final | `npm version X.Y.Z --no-git-tag-version` |

---

**Need the original detailed sources?** Keep `design_docs/RELEASE_CANDIDATE.md`, `design_docs/RELEASE.md`, and `design_docs/PR_Review_for_Dummies.md` bookmarked.
