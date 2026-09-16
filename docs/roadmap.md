# Project Roadmap

Codex Scriptura is built iteratively in vertical slices: self-contained, usable milestones instead of a big-bang backend.

> **The roadmap now lives on GitHub** (migrated 2026-07-18):
>
> - **[Milestones](https://github.com/steveanil/codex-scriptura/milestones)** - one per version, each with its open issues and a progress bar. This is the canonical "what's in v0.5.0" answer.
> - **[Issues](https://github.com/steveanil/codex-scriptura/issues)** - every planned feature and known bug, labeled by area (`area: search`, `area: data-pipeline`, …) and kind (`enhancement`, `bug`, `refactor`, `ux`, `performance`). Ideas without a milestone carry the `parking-lot` label.
> - **Project board** - all issues in one place with a roadmap view, linked from the repo home.
>
> The full item write-ups that used to live in this file were moved verbatim into their issues; this file's git history preserves every revision.

## The Path to 1.0 (version themes)

| Version | Theme | Status |
|---|---|---|
| v0.1.0 | Foundation - monorepo, importers, PWA shell, offline Dexie, reader, search | Released 2026-03 |
| v0.2.0 | Annotate - highlights, notes, tags, command palette, `/search` route | Released 2026-03 |
| v0.3.0 | Personalize & Enrich - preferences, typography, Theographic entities, dictionary, word study | Released 2026-03 |
| v0.4.0 | Deep Study - cross-references, graph, genealogy, split view, lexicon, Strong's search, 7 translations | Released 2026-08 |
| v0.4.1 | Stability & Performance - fixes from the 2026-08 audit, led by the scripture-data criticals | Released 2026-09 |
| v0.4.2 | Design Foundations - tokens, focus and contrast, Study Rail, interaction primitives | [Milestone](https://github.com/steveanil/codex-scriptura/milestones) |
| v0.4.3 | Search & Data Performance - dataset versioning split from schema versioning, shared search index manager, graph precompute, seeding | [Milestone](https://github.com/steveanil/codex-scriptura/milestones) |
| - | **Milestone gate: single-user pilot** - one trusted non-technical tester via Cloudflare Pages + Access; see [pilot-testing.md](pilot-testing.md) | Next |
| v0.5.0 | Manuscript & History - morphology, interlinear, timeline, manuscripts, Church Fathers, Story Mode, plus backup/import pulled forward | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/2) |
| v0.6.0 | Resource Ecosystem - `ResourceDescriptor`, `.csdata` packages, resource manager, commentary as the first content type, SWORD importer for public-domain Catholic translations, licensed remote translation support; no executable plugins yet ([decision D12](architecture-decisions.md)) | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/3) |
| v0.7.0 | Scholar Features - doctrine development tracker, apostolic succession tracker | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/4) |
| v0.8.0 | Migrate & Sync - E2EE sync, Logos/Accordance/e-Sword importers (backup/import moved to v0.5.0) | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/5) |
| v0.9.0 | Public Beta & Reliability - mobile pass, performance, a11y, onboarding, web workers, code health, Crossway ESV and API.Bible integrations, licensing UX | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/6) |
| v1.0.0 | Launch - stable plugin API, desktop wrapper, docs site | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/7) |

Post-1.0 (ministry platform): v1.1.0 Commentary Framework, v1.2.0 Sermon & Teaching Prep, v1.3.0 Devotional & Journaling, v1.4.0 Community & Sharing (the first managed backend; a stateless key-holding proxy for licensed translations may exist earlier, see [decision D13](architecture-decisions.md)), v2.0.0 Multi-Modal Platform - see [milestones](https://github.com/steveanil/codex-scriptura/milestones) for their issue lists.

## Release status

The latest tagged release is [`v0.4.1`](https://github.com/steveanil/codex-scriptura/releases) (2026-09-15). Releases follow the [release-process.md](release-process.md) cadence: `develop` collects squash-merged PRs, and a release PR merges them into `main` with a tag and a What's New entry.
