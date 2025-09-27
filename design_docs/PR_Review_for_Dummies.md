# PR Release Guide (v1.1.1)

## 1. Prep Workspace
- `git checkout release/1.1.1` and confirm `git status` is clean.
- Review `design_docs/RELEASE_CANDIDATE.md` and refresh the checklist.
- Update `CHANGELOG.md` with the 1.1.1 entry (reflecting the release, not the RC).
- Ensure `package.json` (and other version files) read `1.1.1` without the `-rc` suffix.

## 2. Sanity Checks
- Run automated tests (unit/integration/e2e as required).
- Complete any manual validation steps listed in the release checklist.
- Verify the code matches the RC build already published.

## 3. Draft the PR
- Run `git push --set-upstream origin release/1.1.1` so the branch exists on the remote.
- Open your repo in the browser; most hosts pop a "Compare & pull request" banner for the new branch. Click it.
- Ensure the base branch is `main` and the compare branch is `release/1.1.1`; give the PR a release-focused title (e.g. `Release 1.1.1`).
- Paste in the highlights from `CHANGELOG.md` so reviewers see what ships.
- If the banner is gone, use the green "Compare & pull request" or "Create pull request" button; it shows the same screen.
- In the PR form, double-check title/description, then hit "Create pull request" to open it.
- Link or embed the release checklist and mention this PR promotes `v1.1.1-rc.1` to production.

## 4. Self-Review & Approval
- Walk the diff in the PR UI; confirm no unexpected files or merges.
- Tick each release checklist item in `design_docs/RELEASE_CANDIDATE.md`.
- Wait for CI to go green; fix any issues before approving.
- Approve and merge the PR (merge commit or squash per convention).

## 5. Release & Tag
- Switch to `main`, pull latest, and run the production publish command (`npm publish --tag latest` or your final release command).
- Create the `v1.1.1` git tag on the release commit and push tags.

## 6. Back-Merge to Development
- Check out your dev branch (e.g. `develop`), merge or fast-forward from `main`.
- Push the updated dev branch so the released state is shared.
- Mark the release checklist complete, noting the tag and artifacts.

## 7. Post-Release Follow-up
- Archive release notes in docs or project tracker.
- Monitor telemetry/support channels for any issues.
