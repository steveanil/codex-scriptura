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
| v0.4.0 | Deep Study - cross-references, graph, genealogy, split view, lexicon, Strong's search, 7 translations | In progress ([milestone](https://github.com/steveanil/codex-scriptura/milestone/1)) |
| - | **Milestone gate: single-user pilot** - one trusted non-technical tester via Cloudflare Pages + Access; see [pilot-testing.md](pilot-testing.md) | Next |
| v0.5.0 | Manuscript & History - morphology, interlinear, timeline, manuscripts, Church Fathers, Story Mode | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/2) |
| v0.6.0 | Extensibility - plugin system, `.csdata` bundles, sandbox | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/3) |
| v0.7.0 | Scholar Features - doctrine development tracker, apostolic succession tracker | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/4) |
| v0.8.0 | Migrate & Sync - export/import, E2EE sync, Logos/Accordance/e-Sword importers | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/5) |
| v0.9.0 | Polish - mobile pass, performance, a11y, onboarding, web workers, code health | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/6) |
| v1.0.0 | Launch - stable plugin API, desktop wrapper, docs site | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/7) |

Post-1.0 (ministry platform): v1.1.0 Commentary Framework, v1.2.0 Sermon & Teaching Prep, v1.3.0 Devotional & Journaling, v1.4.0 Community & Sharing (first and only backend), v2.0.0 Multi-Modal Platform - see [milestones](https://github.com/steveanil/codex-scriptura/milestones) for their issue lists.

## Release status

The latest tagged release is [`v0.3.2`](https://github.com/steveanil/codex-scriptura/releases) (2026-04-01). Everything merged since ships together as `v0.4.0` when its milestone clears (decision 2026-07-16: no catch-up patch). After `v0.4.0`, return to the [release-process.md](release-process.md) cadence: tag a patch after each feature PR merges instead of batching.
