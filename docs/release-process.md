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
2. **Release-prep PR into `develop`**, opened from the release template (`gh pr create --template release.md`, or add `?template=release.md` to the new-PR URL), containing:
   - A What's New entry in `src/lib/whats-new.ts` (newest first, unique date-based id) covering the user-visible changes in plain language - this is what testers see in-app when the deploy reaches them. Releases without user-visible changes can skip this.
   - The `version` field bumped in all package.json files across the monorepo (e.g. `package.json`, `packages/core/package.json`, etc.).
   - The [documentation truth check](#documentation-truth-check) below, completed and ticked in the PR body.
   - Title: `chore(release): bump monorepo packages to v0.5.0`.
3. **Open the release PR:** `develop` -> `main`, titled `release: v0.5.0`.
4. Merge it with a **merge commit** (never squash - it would collapse the release into one commit and break per-PR release notes).
5. Create an annotated git tag on `main` and push it:
   ```bash
   git checkout main && git pull
   git tag -a v0.5.0 -m "Release v0.5.0"
   git push origin v0.5.0
   ```

## Documentation truth check

The docs drifted from the code for months once and were fixed in one sweep (#359, #360). The release-prep PR is where drift is caught now, and the release PR cannot merge without it (issue #361). The rule for the permanent docs: describe the current contract, not the path taken to reach it. Experiments that were measured and dropped, migration scaffolding and comparisons against retired code belong in the issue, the PR or the release notes, not in `architecture.md`.

**Automated** (`pnpm docs:check`; runs in CI on every PR, and against a freshly built manifest on the release PR):

- the Dexie schema version in `packages/db/src/schema.ts` against the `**schema version N**` phrase in `docs/architecture.md`
- every package.json `version` equal, and named as the latest release in `docs/roadmap.md` (the status line and the version table row)
- the shipped dataset table in `docs/features.md` against `static/data/manifest.json` (record counts and sizes)
- a warning when the newest What's New entry is not for this version

`pnpm docs:check --update` regenerates the schema phrase and the dataset table; run the pipeline first (`pnpm setup:data`) so the manifest is current.

**Reviewed by a person** in the release-prep PR, with the release template's checklist:

- `docs/architecture.md`: does every section describe what the code does now? Anything "slated", "planned" or "pending" that has since shipped or been dropped?
- `docs/features.md`: does the inventory match the milestone's merged PRs, and are the known gaps still gaps?
- `docs/data-architecture.md` and `docs/architecture-decisions.md`: are the status headers and the decisions' "today" statements current? New decisions get a dated record, old ones are not rewritten.
- `docs/roadmap.md` and `README.md`: the milestone row says Released with the date, the status paragraph names this release, the next milestone is the one actually next.
- Release status: version fields bumped everywhere, What's New entry present and readable by a tester, the milestone has no open issues that were not moved deliberately.

## GitHub Releases

We use GitHub Releases (the "Releases" sidebar on the repo) to attach changelogs to our tags.

**Publishing with `gh`.** Do not combine `--notes` with `--generate-notes`: gh appends the generated block to the supplied notes and, with `--notes-start-tag` as well, appended it twice on v0.4.2. Generate first, prepend the highlights, publish from one file:

```bash
gh api repos/steveanil/codex-scriptura/releases/generate-notes \
  -f tag_name=v0.5.0 -f previous_tag_name=v0.4.2 --jq .body > /tmp/generated.md
{ cat highlights.md; echo; cat /tmp/generated.md; } > /tmp/notes.md
gh release create v0.5.0 --verify-tag --title "Codex Scriptura v0.5.0: <headline>" --notes-file /tmp/notes.md
```

**What goes in a Release Note?**
- **Headline:** A human-readable title (e.g., *Codex Scriptura v0.1.0: Foundation*).
- **Highlights:** 2-3 bullet points emphasizing what major value was added for the end user.
- **Changelog:** A grouped list of the squash-merge commit messages since the last release. Group by `Feature`, `Fix`, and `Chore`. (GitHub's "Generate release notes" button does a great job at automating this).
- **Binary/Artifact Attachments:** (Eventually) When Tauri or Electron desktop builds are added, the `.dmg` and `.exe` files go here.

## Reaching 1.0

Version `1.0.0` is cut when the core study workflow, user-data durability (backup, import, annotation editing), the resource system, the accessibility and performance targets, and the public-beta reliability criteria from v0.9.0 are stable enough for general release, and the launch features that give general readers a way in have shipped: Story Mode (#50), the offline Biblical atlas (#106) and the Gospel harmony viewer (#198). Executable plugin API stability is **not** a v1.0 requirement; it has its own target under v1.1.0 Executable Plugin Runtime, where the API is versioned and no breaking change ships without a major bump. See [architecture-decisions.md](architecture-decisions.md) D12 and D16.
