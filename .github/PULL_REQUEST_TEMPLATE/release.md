## Release prep: vX.Y.Z

<!-- Use this template for the release-prep PR into develop (docs/release-process.md, step 2).
     gh pr create --base develop --template release.md -->

- Milestone: <!-- link -->
- Headline: <!-- one line, the What's New title -->

---

## Documentation truth check

Automated (`pnpm docs:check`; the release PR's CI runs it against a freshly built manifest):

- [ ] Ran `pnpm setup:data` then `pnpm docs:check --update`, and committed what it regenerated
- [ ] `pnpm docs:check` passes locally with no warnings

Reviewed by hand (describe what the code does now, not how it got there):

- [ ] `docs/architecture.md` - every section matches the code; nothing "slated", "planned" or "pending" that has since shipped or been dropped
- [ ] `docs/features.md` - matches the milestone's merged PRs; the known gaps are still gaps
- [ ] `docs/data-architecture.md` - status header and registered sources are current
- [ ] `docs/architecture-decisions.md` - the "today" statements are current; new decisions got a dated record
- [ ] `docs/roadmap.md` - this version's row says Released with the date; the status paragraph names it; the next milestone is the one actually next
- [ ] `README.md` - the status section names this release and what is next
- [ ] Deferred work is stated as deferred (issue links), not left reading as planned-for-this-release

## Release status

- [ ] `version` bumped in `package.json` and every `packages/*/package.json`
- [ ] What's New entry in `src/lib/whats-new.ts` titled `... (vX.Y.Z)`, written for the app's reader (or: no user-visible changes, stated here)
- [ ] The milestone has no open issues except ones moved on purpose (say which)
- [ ] `pnpm check`, `pnpm test` and `pnpm test:e2e` (standalone) pass on this branch
- [ ] Cross-references were force-fetched before the pipeline run, so the deploy's checksum gate will not trip on an OpenBible refresh

---

## Notes for Reviewer

<!-- Anything the reviewer should look at first -->
-
