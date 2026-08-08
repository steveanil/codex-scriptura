# Git Branching Strategy

As of 2026-07-22 (v0.5.0 cycle onward), Codex Scriptura uses a two-branch flow: `main` tracks what is live on the website, and `develop` is the integration branch where a release cycle accumulates. This replaces the single-branch GitHub Flow we used through v0.4.x.

## The Branches

### `main` - production
- Always matches the deployed site at codex-scriptura.pages.dev.
- Nothing merges here except release merges from `develop` (and their version tags).
- Never commit directly to `main`.

### `develop` - integration
- The default target for all day-to-day Pull Requests: features, fixes, docs, refactors.
- Holds everything slated for the next release. It should stay buildable, but it is allowed to be "in progress" between releases.
- Never commit directly to `develop` either - PRs only.

### Feature/fix branches (short-lived)
- Branch off `develop` for every piece of work.
- **Naming format:** `type/kebab-case-description`

**Examples:**
- `feat/usfx-importer`
- `fix/osis-regex-bug`
- `docs/add-readme`
- `refactor/db-schema`

## Merging rules

| Merge | Method | Why |
|---|---|---|
| feature/fix -> `develop` | **Squash and Merge** | One clean Conventional-Commits entry per PR; matches [commit conventions](commit-conventions.md). |
| `develop` -> `main` (release) | **Merge commit** (never squash) | Preserves the individual squashed PR commits on `main`, so GitHub's auto-generated release notes (`.github/release.yml`) can still group them by PR label. Squashing would collapse the whole release into one anonymous commit. |

## Release workflow (e.g. v0.5.0)

1. Feature PRs (`feat/x`, `feat/y`, ...) each merge to `develop` via squash, closing their issues with `Closes #N`.
2. When the milestone is done and tested, open a release PR: `develop` -> `main`, titled `release: v0.5.0`.
3. Merge it with a **merge commit**, tag `v0.5.0` on `main`, and publish the release (notes auto-generate from the included PRs).
4. Update the in-app "What's new" as part of the release cycle (last PR into `develop` before the release PR, so it ships with the code it describes).
5. Deploy runs from `main`.

## Bugfix / patch workflow (e.g. v0.5.1)

1. Each reported bug gets its own `fix/*` branch off `develop` and its own PR into `develop`.
2. When the batch of fixes is ready, cut a release PR `develop` -> `main` as above and tag `v0.5.1`.
3. There is no separate `hotfix` branch tier. If something is ever so urgent it cannot ride the next patch release, branch off `main`, PR to `main`, then merge `main` back into `develop` immediately so the branches do not diverge.

## Keeping the branches in sync

- After every release merge, `develop` and `main` point at the same tree - no back-merge needed because `develop` -> `main` used a merge commit.
- If a rare hotfix lands on `main` directly, merge `main` into `develop` right away.

## Why this approach?

- **`main` is honest:** whatever a user sees on the live site is exactly `main`. Half-finished milestone work never leaks into production.
- **Releases are deliberate:** a version bump, tag, "What's new" entry, and deploy all happen in one visible release PR.
- **Contributor friendly:** contributors branch off `develop` and PR back into `develop`; only the maintainer touches `main`.
