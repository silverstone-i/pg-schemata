# 🛠️ pg-schemata Release Guide (For Dummies)

This single playbook walks you from an approved release candidate (`vX.Y.Z-rc.N`)
all the way to a polished production release (`vX.Y.Z`). Every step is spelled out
with explanations so you always know *why* you are typing a command.

---

## 0. Big Picture

1. Make sure your working tree is clean and your automated checks pass.
2. Cut or reuse the `release/X.Y.Z` branch and prepare the release candidate (RC).
3. Publish the RC to npm under the `rc` tag so testers can try it.
4. Push the branch, open a pull request (PR) into `main`, and self-review it.
5. Merge the PR, publish the final build to npm under `latest`, and tag the repo.
6. Sync branches, update GitHub releases, and tidy up.

Keep `design_docs/RELEASE_CANDIDATE.md`, `design_docs/RELEASE.md`, and
`design_docs/PR_Review_for_Dummies.md` bookmarked if you ever want the original
sources—all their content is captured below.

---

## 1. Pre-flight Checklist (Do This Once)

Command | Why you run it
---|---
`git status` | Confirms your working tree is clean before you start.
`git checkout dev` | Moves you to the main development branch.
`git pull origin dev` | Pulls the newest commits from GitHub to your local machine.
`npm ci` | Installs exact dependency versions from `package-lock.json`.
`npm test` | Runs the automated tests so you do not ship broken code.

```bash
git status
git checkout dev
git pull origin dev
npm ci
npm test
```

If any step fails, stop and fix it before moving forward.

---

## 2. Create or Update the Release Candidate Branch

We keep one branch per target version. Example target version: **1.1.1**.

Step | Command | What it does
---|---|---
Create the branch | `git checkout -b release/1.1.1` | Creates a new branch named `release/1.1.1` from your current branch and switches you to it.
Reuse the branch | `git checkout release/1.1.1` | Switches to the existing branch if you already created it earlier.
Sync with dev | `git merge --ff-only dev` | Fast-forwards the release branch so it includes the newest commits from `dev`. This command fails if there are conflicts; resolve them before retrying.

Always re-run `npm test` (and any other checks like `npm run lint`) after pulling in new code.

---

## 3. Bump Package Versions for the RC

Decide which `npm version` command matches your release:

- `npm version prepatch --preid=rc --no-git-tag-version`
- `npm version preminor --preid=rc --no-git-tag-version`
- `npm version premajor --preid=rc --no-git-tag-version`
- `npm version prerelease --preid=rc --no-git-tag-version` (use when you only need to bump `rc.N`)

Explanation:

- `npm version` updates `package.json` (and `package-lock.json`).
- The `pre*` commands add or bump the `-rc.N` suffix.
- `--preid=rc` sets the suffix to `rc`.
- `--no-git-tag-version` stops npm from making a git tag immediately—you will tag later after review.

After bumping, confirm the value:

```bash
node -p "require('./package.json').version"
```

Stage and commit the change:

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to v1.1.1-rc.1"
```

`git add` stages the edited files, and `git commit` records the change with a message everyone can understand.

Update `CHANGELOG.md` and any docs (release notes, migration guides). When you are done, repeat `git status` to confirm only the files you expect are staged.

---

## 4. Build and Smoke-Test the RC

Run the same commands your users rely on:

```bash
npm run lint
npm run build   # run this if the project defines a build step
npm test
npm pack        # bundles the package; inspect pg-schemata-<version>.tgz if needed
```

- `npm run lint` checks code style.
- `npm run build` compiles distributables.
- `npm test` re-runs the test suite after the version bump.
- `npm pack` creates an installable tarball identical to what npm publish uses.

If anything fails, fix it and re-run the commands until they all pass.

---

## 5. Commit and Tag the Release Candidate

Once the RC is ready:

```bash
git status
```

Confirm the status shows only the files you intend to ship. Then create a release commit if needed and tag it for reference:

```bash
git commit -am "release: v1.1.1-rc.1"   # Skips this if you already committed everything.
git tag v1.1.1-rc.1
```

- `git commit -am` commits all tracked changes; use it only if the files were already tracked.
- `git tag v1.1.1-rc.1` creates a lightweight tag so you can always revisit this exact candidate.

Push the branch and the tag to GitHub:

```bash
git push --set-upstream origin release/1.1.1
git push origin v1.1.1-rc.1
```

- The first command uploads the branch and tells Git to track `origin/release/1.1.1` so future pushes can be just `git push`.
- The second command uploads the RC tag for historical reference.

---

## 6. Publish the RC to npm

Make sure you are signed in:

```bash
npm whoami
```

If the command prints your npm username, you are logged in. If it errors, log in with `npm login` and follow the prompts.

Publish the candidate:

```bash
npm publish --tag rc
```

- `npm publish` uploads the package in your working directory.
- `--tag rc` tells npm to attach the `rc` dist-tag so users must explicitly request it (`npm install pg-schemata@rc`).

Verify what went up:

```bash
npm view pg-schemata@rc version dist-tags
```

Share install instructions with testers:

```bash
npm install pg-schemata@v1.1.1-rc.1
```

Optionally draft a GitHub pre-release (Releases → Draft new release → mark as pre-release) so the candidate is easy to find.

---

## 7. Prepare the Production Pull Request

### 7.1 Push the Branch (if you have not already)

```bash
git push --set-upstream origin release/1.1.1
```

This uploads the branch and links it with the remote so future `git push` or `git pull` commands know where to send/receive changes.

### 7.2 Open the PR on GitHub

1. Visit your repository in the browser (`https://github.com/<org>/pg-schemata`).
2. GitHub usually shows a yellow banner: “Compare & pull request.” Click it. If you miss it, hit the green **Compare & pull request** or **Create pull request** button.
3. Double-check the base branch is `main` and the compare branch is `release/1.1.1`.
4. Title suggestion: `Release 1.1.1`.
5. Paste the highlights from `CHANGELOG.md` into the description.
6. Link to this checklist or embed it so everything is auditable.
7. Mention that this PR promotes `v1.1.1-rc.1` to production.
8. Click **Create pull request**.

### 7.3 Self-Review the PR

1. Scroll through the Files Changed tab. Look for surprises.
2. Tick each item in your release checklist (`design_docs/RELEASE_CANDIDATE.md`).
3. Wait for CI to finish. If a job fails, click through, fix the issue locally, commit, and push again (`git push`).
4. When everything looks right, approve the PR (yes, approving your own PR is fine when working solo).

### 7.4 Merge the PR

Choose the merge strategy your repo normally uses:

- **Merge commit** keeps the exact history (`Merge pull request`).
- **Squash** condenses to a single commit (useful if you have messy intermediate commits).

After merging, GitHub offers a button to delete the branch. Hold off until the GA release is fully done.

---

## 8. Promote the Candidate to General Availability

### 8.1 Update Local `main`

```bash
git checkout main     # Switches to the main branch
git pull origin main  # Downloads the merged PR

# Optional safety check: make sure the release branch is fully merged
git branch --merged | grep release/1.1.1
```

### 8.2 Bump the Final Version (Remove `-rc`)

From `main`, set the real version:

```bash
npm version 1.1.1
```

- This updates `package.json` and `package-lock.json`.
- npm also creates a commit (`v1.1.1`) and a git tag (`v1.1.1`).

If you prefer to edit manually and skip the tag:

```bash
npm version 1.1.1 --no-git-tag-version
# ...edit commit message yourself later and run `git tag v1.1.1`
```

### 8.3 Publish to npm Under `latest`

```bash
npm publish --tag latest
```

- Most users install `pg-schemata` without specifying a tag; npm serves whatever is in `latest`, so make sure this command succeeds.

### 8.4 Push Commits and Tags to GitHub

```bash
git push origin main
git push origin v1.1.1
```

- The first command uploads the commits on `main`.
- The second uploads the git tag so others can check out exactly what you shipped.

### 8.5 Update npm Dist-Tags (If Needed)

If an older dist-tag points at a previous build, move it:

```bash
npm dist-tag add pg-schemata@1.1.1 latest
npm dist-tag rm pg-schemata rc
```

`npm dist-tag add` moves or creates a tag pointing to the version you specify, and `npm dist-tag rm` deletes a tag you no longer need.

### 8.6 Publish a GitHub Release (Optional but Recommended)

1. Go to the Releases tab.
2. Click **Draft a new release**.
3. Select the `v1.1.1` tag and target branch `main`.
4. Paste the release notes from `CHANGELOG.md`.
5. Publish the release (do not mark as pre-release this time).

### 8.7 Deploy Documentation (If Required)

If you publish docs to GitHub Pages:

```bash
mkdocs gh-deploy
```

This command builds the docs and pushes the result to the `gh-pages` branch.

Visit `https://silverstone-i.github.io/pg-schemata/` to confirm the update.

---

## 9. Post-Release Branch Sync

Your development branch should learn about the released state:

```bash
git checkout dev
```

This switches you back to the dev branch.

```bash
git merge --ff-only main
```

- Fast-forwards `dev` to include the release commit. If git complains (because `dev` has new commits), drop `--ff-only` and do a normal merge.

```bash
git push origin dev
```

Push your updated `dev` branch so teammates and CI are aligned.

When everything is fully synced (and after double-checking tags/releases), you can delete the release branch:

```bash
git branch -d release/1.1.1        # Deletes the local branch
git push origin --delete release/1.1.1
```

Only delete after the GA release is 100% verified.

---

## 10. Monitor and Iterate

- Announce the release internally/externally.
- Watch error tracking, logs, and support channels for regressions.
- File follow-up issues for anything you postpone.
- Update documentation or tutorials as feedback arrives.

If problems appear, fix them on `dev`, cherry-pick onto `release/1.1.1`, bump the RC (`npm version prerelease --preid=rc --no-git-tag-version`), republish with `npm publish --tag rc`, and start from Section 6 again.

---

**Need a quicker reminder?** The short version of the commands (without context) lives at the end of your terminal history. But when in doubt, come back to this playbook—the explanations will keep you out of trouble.
