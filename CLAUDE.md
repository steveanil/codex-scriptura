# CLAUDE.md

Codex Scriptura: a plugin-extensible, offline-first Bible study PWA (SvelteKit 5 runes + Dexie/IndexedDB, pnpm monorepo). Docs index: `docs/README.md`.

## Project tracking lives on GitHub, not in markdown

Migrated 2026-07-18. Do not add roadmap items or bug lists to `docs/roadmap.md` or `docs/known-issues.md` - both are pointer files now.

- **Planned work**: [Issues](https://github.com/steveanil/codex-scriptura/issues) assigned to version [Milestones](https://github.com/steveanil/codex-scriptura/milestones) (v0.4.0 Deep Study ... v2.0.0). Check `gh issue list --milestone "<title>"` before proposing scope; unscheduled ideas get the `parking-lot` label instead of a milestone.
- **New bugs**: file an issue with a severity label - `severity: critical` (wrong/missing scripture data or data loss), `severity: high` (user-visible malfunction), `severity: medium` (edge case/performance), `severity: low` (hygiene). Add `area: *` labels (search, reader, db, data-pipeline, graph, mobile, a11y, plugins, sync).
- **Fixing something tracked**: put `Closes #N` in the PR body; squash-merge closes it. The closed issue is the fix record - don't also write it up in a doc.
- **Releases**: notes auto-generate from merged PRs grouped by label (`.github/release.yml`), so PR titles and labels matter. Process: `docs/release-process.md`.
- **Board**: [Codex Scriptura Roadmap](https://github.com/users/steveanil/projects/4) holds all open issues.

## Git & PR process (details in docs/)

- `pnpm` only, never npm.
- GitHub Flow (`docs/branching-strategy.md`): branch off `main` as `type/kebab-description`, PR to `main`, **squash-merge**. Never commit to `main` directly. **After any PR merges, verify its base was `main`** - a merged PR whose base was another branch never reaches main (this bit us with PR #18).
- Conventional Commits (`docs/commit-conventions.md`); PR bodies follow `.github/pull_request_template.md`.
- Never type em-dashes anywhere: code, docs, commits, PR text, UI copy. Use " - " or rewrite the sentence.

## Verifying changes

`.claude/skills/verify` has the headless-browser recipe (dev server port 5199, block the service worker, fresh-profile seeding takes 1-2 min). Deploys must run the data pipeline (`fetch` + `import:all` + copy) because `static/data/` is gitignored.
