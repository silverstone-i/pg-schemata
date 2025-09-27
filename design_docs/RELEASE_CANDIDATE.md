# 🚀 Release Candidate Workflow for `pg-schemata`

This guide walks through creating, publishing, and iterating on a release candidate (RC)
for `pg-schemata`. Follow these steps when you want early adopters to validate a build
before tagging a final release.

---

## 1. Pre-flight checklist

- Working tree clean on `dev`
- Automated checks passing (`npm test`, linting, type checks)
- CHANGELOG and migration guides updated
- npm account has publish rights (`npm whoami`)
- GitHub Personal Access Token ready if using CLI utilities

```bash
git checkout dev
git pull origin dev
npm ci
npm test
```

---

## 2. Cut an RC branch

Create a dedicated branch so fixes can land without blocking `dev`. Use **one
branch per target version** and reuse it for every RC iteration (do not create a
new branch for each `rc.N`):

```bash
export TARGET_VERSION=1.4.0
export RC_ITERATION=0
export RC_NAME="v${TARGET_VERSION}-rc.${RC_ITERATION}"

# First RC for this version:
git checkout -b release/${TARGET_VERSION}

# For subsequent RCs of the same version, reuse the branch:
# git checkout release/${TARGET_VERSION}

# When you respin the RC, bump the counter and derived name:
export RC_ITERATION=$((RC_ITERATION + 1))
export RC_NAME="${TARGET_VERSION}-rc.${RC_ITERATION}"
```

Use tags like ${RC_NAME} for each iteration; keep the branch name as release/${TARGET_VERSION}.

> Increase `RC_ITERATION` (rc.1, rc.2, …) if you need to respin the candidate.

---

## 3. Bump package metadata

Target version: v1.1.0-rc.0 (package.json should read 1.1.0-rc.0)

```bash
# Optional: keep env in sync with this RC
export TARGET_VERSION=1.1.0
export RC_ITERATION=0
export RC_NAME="v${TARGET_VERSION}-rc.${RC_ITERATION}"

npm version premajor --preid=rc --no-git-tag-version    # Increment major version
npm version preminor --preid=rc --no-git-tag-version    # Increment minor version
npm version prepatch --preid=rc --no-git-tag-version    # Increment patch version
npm version prerelease --preid=rc --no-git-tag-version  # Increment rc version

git add package.json package-lock.json
git commit -m "chore: bump version to ${RC_NAME}"
```

```bash
node -p "require('./package.json').version"
```

If you prefer explicit control, edit the files manually to `1.4.0-rc.0` before committing.

---

## 4. Final verification build

Run everything that should work for downstream users:

```bash
npm run lint
npm run build      # add if/when a build exists
npm test
npm pack           # creates pg-schemata-<version>.tgz
```

Unpack the tarball in a temp directory and run a smoke test if possible.

---

## 5. Commit and tag the candidate

```bash
git status
git commit -am "release: ${RC_NAME}"
git tag ${RC_NAME}
```

Push branch and tag for review:

```bash
git push origin release/${TARGET_VERSION}
git push origin ${RC_NAME}
```

Open a PR from `release/${TARGET_VERSION}` → `main` (mark as draft until the RC is
promoted).

---

## 6. Publish to npm with an RC dist-tag

```bash
npm publish --tag rc
```

This makes the candidate installable via `npm install pg-schemata@rc` without
affecting the default `latest` tag. Inspect the published metadata:

```bash
npm view pg-schemata@rc version dist-tags
```

If you need a scoped dist-tag (e.g. `next`), replace `--tag rc` accordingly.

---

## 7. Share install instructions

Let testers know how to consume the candidate:

```bash
npm install pg-schemata@${RC_NAME}
```

Provide release notes (pull the RC section from `CHANGELOG.md`) and link to
any migration tutorials relevant to the changes.

---

## 8. Draft a GitHub pre-release

1. Go to the Releases tab
2. Click **“Draft a new release”**
3. Pick `${RC_NAME}` as the tag (mark as pre-release)
4. Target `release/${TARGET_VERSION}` or `main` if already merged
5. Paste the RC notes

This helps surface the candidate without signalling a final GA release.

---

## 9. Iterate quickly

- Collect feedback and file issues against the RC branch.
- For each fix, merge into `dev` first, then cherry-pick onto `release/${TARGET_VERSION}`.
- Bump the prerelease number (`npm version prerelease --preid=rc`) and republish
  (`npm publish --tag rc`).

Repeat until the candidate is stable.

---

## 10. Promote to general availability

Once the RC is approved:

1. Merge `release/${TARGET_VERSION}` into `main`.
2. Follow the standard release steps in `design_docs/RELEASE.md` (which will
   bump to `1.4.0` and publish with the `latest` dist-tag).
3. Update npm tags:

   ```bash
   npm dist-tag add pg-schemata@${TARGET_VERSION} latest
   npm dist-tag rm pg-schemata rc
   ```

4. Merge `main` back into `dev` to carry forward the stable version.

---

> Keep historical RC tags—they document what went out for testing.
> Delete stale `release/` branches once the final build ships.

_Last updated: 2025-06-22_
