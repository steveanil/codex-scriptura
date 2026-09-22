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
| v0.4.2 | Design Foundations - tokens, focus and contrast, Study Rail, interaction primitives, settings redesign, backup export and import | Released 2026-09 |
| v0.4.3 | Data Lifecycle & Performance - dataset versioning split from schema versioning, db package domain split, importer validation, shared search index manager and concordance query strategy, graph precompute, staged first-run seeding, release doc truth check | Released 2026-09 |
| - | **Milestone gate: single-user pilot** - one trusted non-technical tester via Cloudflare Pages + Access; see [pilot-testing.md](pilot-testing.md) | Next |
| v0.5.0 | Core Study - commentary in the Study Rail, `ResourceDescriptor`, word study on tap and full lexicon entries, footnotes, BSB alignment rebuild, annotation editing and tag management, backup hardening, credits and licenses, PaneState and reader decomposition ([decision D15](architecture-decisions.md)) | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/2) |
| v0.6.0 | Resource Ecosystem - `.csdata` package format, external package verification, Resource Manager; first-party datasets, dictionaries, topical Bibles, Church Fathers and Nave's as resources; SWORD importer for public-domain Catholic translations; licensed remote translation seam; no executable plugins and no activity features ([decision D15](architecture-decisions.md)) | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/3) |
| v0.7.0 | Scholar Features - morphology search, interlinear, timeline, Manuscript Explorer, provenance and competing claims, Reading with the Fathers, reception history, doctrine development and apostolic succession trackers | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/4) |
| v0.8.0 | Migrate & Sync - E2EE sync, Logos/Accordance/e-Sword importers (backup/import moved to v0.5.0) | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/5) |
| v0.9.0 | Public Beta & Reliability - mobile pass, performance, a11y, onboarding, web workers, code health, Crossway ESV and API.Bible integrations, licensing UX | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/6) |
| v1.0.0 | Launch - documentation site, launch hardening, boolean and proximity search, desktop wrapper if still justified. Executable plugins are not a launch blocker; the gate is in [release-process.md](release-process.md) | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/7) |
| v1.1.0 | Executable Plugin Runtime - transport-neutral async Plugin API, trusted first-party tier, sandboxed third-party tier, plugin storage, permissions, views, panels, decorations, plugin-safe categorical colour slots; proved by three first-party plugins: speaker highlighting (decoration), units converter (UI interaction), vocab drills (Worker and storage) | [Milestone](https://github.com/steveanil/codex-scriptura/milestone/16) |

Post-1.1 (product expansion): v1.2.0 Sermon & Teaching Prep, v1.3.0 Devotional & Journaling (holds the activity chain: reading logs, then reading plans, then the contribution graph and stats), v1.4.0 Community & Sharing (marketplace, shared guides, hosted reading-plan discovery, collaboration; the first stateful backend, see below), v2.0.0 Multi-Modal Platform - see [milestones](https://github.com/steveanil/codex-scriptura/milestones) for their issue lists.

Three forms of extensibility, deliberately kept apart: **resource extensibility** (`.csdata`, no executable code, v0.6.0), **licensed remote resources** (provider-backed content behind stateless credential infrastructure, v0.9.0), and **executable extensibility** (the Plugin API, v1.1.0). Backend rule: Codex does not introduce a stateful user-data backend until features involving shared or community state require one. Stateless infrastructure required to protect third-party credentials or access licensed resources is permitted earlier ([decision D13](architecture-decisions.md)).

This spine is considered stable as of 2026-09-17 ([decision D15](architecture-decisions.md)). Milestone boundaries move only when implementation or beta-user evidence forces it.

## Release status

The latest tagged release is [`v0.4.3`](https://github.com/steveanil/codex-scriptura/releases) (2026-09-22). Releases follow the [release-process.md](release-process.md) cadence: `develop` collects squash-merged PRs, and a release PR merges them into `main` with a tag and a What's New entry.
