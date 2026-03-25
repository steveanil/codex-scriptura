# Release Process & Versioning

Codex Scriptura uses [Semantic Versioning 2.0.0](https://semver.org/).

We are currently in a **pre-1.0** phase. According to SemVer, `0.y.z` versions indicate initial development. Anything MAY change at any time. The public API should not be considered stable.

## Version Strategy

Before `v1.0.0`, version bumps have a specific cadence for this project:

- **MAJOR (0.x.0) for Milestones:** Increment the middle number when completing a major roadmap feature set.
  - e.g., `v0.1.0` (Foundation), `v0.2.0` (Annotations), `v0.3.0` (Cross-References).
- **MINOR (0.0.x) for Incremental Features/Fixes:** Increment the last number for individual features, UI improvements, bug fixes, or new text pipelines merged into main.
  - e.g., adding an NASB importer would bump `v0.1.0` to `v0.1.1`.

## How to Release

1. Make sure all intended PRs are squash-merged into `main`.
2. Update the `version` field in all package.json files across the monorepo (e.g. `package.json`, `packages/core/package.json`, etc.).
3. Commit these changes: `git commit -m "chore(release): bump monorepo packages to v0.1.0"`
4. Push to `main`.
5. Create an annotated git tag locally and push it:
   ```bash
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
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
