# Release Process & Versioning

Codex Scriptura uses [Semantic Versioning 2.0.0](https://semver.org/).

We are currently in a **pre-1.0** phase. According to SemVer, `0.y.z` versions indicate initial development. Anything MAY change at any time. The public API should not be considered stable.

## Version Strategy

Before `v1.0.0`, version bumps have a specific cadence for this project:

- **Minor (0.x.0) for Milestones:** Increment the middle number when completing a major roadmap feature set.
  - e.g., `v0.1.0` (Foundation), `v0.2.0` (Annotate), `v0.3.0` (Personalize & Enrich), `v0.4.0` (Deep Study).
- **Patch (0.0.x) for Incremental Features/Fixes:** Increment the last number for batches of bug fixes, UI improvements, or small features released from `develop` after a milestone ships.
  - e.g., `v0.3.1` (navigation & polish), `v0.3.2` (bug fixes & contributor setup).

## How to Release

Releases flow `develop` -> `main` (see [branching-strategy.md](branching-strategy.md)); `main` is what the live site runs.

1. Make sure all intended PRs are squash-merged into `develop` and the milestone is tested.
2. **Release-prep PR into `develop`** containing:
   - A What's New entry in `src/lib/whats-new.ts` (newest first, unique date-based id) covering the user-visible changes in plain language - this is what testers see in-app when the deploy reaches them. Releases without user-visible changes can skip this.
   - The `version` field bumped in all package.json files across the monorepo (e.g. `package.json`, `packages/core/package.json`, etc.).
   - Title: `chore(release): bump monorepo packages to v0.5.0`.
3. **Open the release PR:** `develop` -> `main`, titled `release: v0.5.0`.
4. Merge it with a **merge commit** (never squash - it would collapse the release into one commit and break per-PR release notes).
5. Create an annotated git tag on `main` and push it:
   ```bash
   git checkout main && git pull
   git tag -a v0.5.0 -m "Release v0.5.0"
   git push origin v0.5.0
   ```

## GitHub Releases

We use GitHub Releases (the "Releases" sidebar on the repo) to attach changelogs to our tags.

**What goes in a Release Note?**
- **Headline:** A human-readable title (e.g., *Codex Scriptura v0.1.0: Foundation*).
- **Highlights:** 2-3 bullet points emphasizing what major value was added for the end user.
- **Changelog:** A grouped list of the squash-merge commit messages since the last release. Group by `Feature`, `Fix`, and `Chore`. (GitHub's "Generate release notes" button does a great job at automating this).
- **Binary/Artifact Attachments:** (Eventually) When Tauri or Electron desktop builds are added, the `.dmg` and `.exe` files go here.

## Reaching 1.0

Version `1.0.0` will only be cut when the **Plugin API** is finalized and stabilized. A stable plugin API is the guarantee that extensions won't unexpectedly break.
