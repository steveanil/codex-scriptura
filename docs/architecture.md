# Architecture

Codex Scriptura is an offline-first Bible study PWA. All reads and writes at runtime happen against a local IndexedDB database; the network is only needed once, to download the app shell and the seed data. Everything the app knows - translations, cross-references, people, places, genealogy, lexicons, topics - is produced ahead of time by a build-time data pipeline and shipped as static JSON.

This document describes the system as it exists in the code today. Deeper dives live in:

- [architecture-decisions.md](architecture-decisions.md) - where the architecture is going and why; dated decision records
- [data-architecture.md](data-architecture.md) - multi-source provenance, entity resolution, and merge model
- [core-vs-plugins.md](core-vs-plugins.md) - what belongs in core, what is a resource, what is a plugin
- [plugin-api.md](plugin-api.md) - draft plugin contract and the `.csdata` resource package
- [sync-and-accounts.md](sync-and-accounts.md) - future E2EE sync design

## System overview

```
BUILD TIME (Node, packages/data-pipeline)
  upstream sources          data/ (raw, gitignored)      data/processed/ (JSON)
  ─ eBible, CrossWire   →   fetch-*.ts               →   importers/*.ts        →   copy-to-static.ts
  ─ Theographic, OpenBible      (pinned + checksummed)       (parse, enrich,           (split files > 20 MB)
  ─ BibleData, morphhb...                                     validate)                      │
                                                                                             ▼
RUNTIME (browser)                                                                  static/data/*.json
  Dexie (IndexedDB)  ←  src/lib/seed.ts (first-boot seeding)  ←  fetch('/data/…')  ←  (gitignored, rebuilt in CI)
        │
        ▼
  SvelteKit 5 SPA - reader workspace, search, graph, settings
  (service worker precaches the app shell; seed JSON is fetched once, never cached)
```

## The stack

- **SvelteKit 2 + Svelte 5 runes** - `runes: true` is forced for all app code in `svelte.config.js`. The app is a pure SPA: `ssr = false`, `prerender = true` in `src/routes/+layout.ts`, built with `adapter-static` and an `index.html` fallback.
- **Dexie.js 4** (Apache-2.0, no usage limits - the "3 users" limit applies only to the separate Dexie Cloud service, which we do not use) wrapping IndexedDB.
- **MiniSearch** for client-side full-text indexing; **d3-force** and hand-rolled SVG for graph views; **Leaflet** for place maps; vanilla CSS driven by custom properties.
- **Node + tsx** for the data pipeline. No bundling step anywhere in the packages: the app consumes workspace packages as raw TypeScript source through Vite (`server.fs.allow: ['packages']`).
- **pnpm** workspaces, **Vitest** for unit tests, hand-rolled **playwright-core** scripts for e2e (`tests/e2e/`), Cloudflare Pages for hosting.

## Monorepo layout

The SvelteKit app lives at the repo root; `pnpm-workspace.yaml` adds `packages/*` and `plugins/*`.

| Package | Purpose |
|---|---|
| root (`codex-scriptura`) | The PWA itself: `src/routes`, `src/lib`, `src/service-worker.ts` |
| `@codex-scriptura/core` | Shared domain types, the canonical `BOOKS` table, reference parsing (`parseReference`, `toOsisId`), graph node/edge model. Zero runtime deps. |
| `@codex-scriptura/db` | The Dexie schema (`CodexDB`) plus every query/persistence helper. Depends only on `dexie` and `core`. |
| `@codex-scriptura/data-pipeline` | Build-time ETL (see below). Never shipped to the browser. |
| `@codex-scriptura/plugin-api` | Stub package - the contract is still a design doc (`docs/plugin-api.md`). |
| `plugins/example-votd` | Empty placeholder directory. |

Dependency edges: app → `core` + `db`; `db` → `core`; `data-pipeline` imports `core` (types, book table, versification helpers).

## The data pipeline

Everything under `packages/data-pipeline/`. Three layers:

- `src/*.ts` - thin CLI entrypoints, one per pnpm script.
- `src/importers/*.ts` - the actual parsing and transformation logic, unit-tested alongside (`*.test.ts`).
- `src/core/*.ts` - shared infrastructure: paths, CSV/XML helpers, the source registry, checksums, entity resolution, conflict tracking, import-run auditing, versification.

Data flows through three directories, all anchored via `src/core/paths.ts` (resolved from `import.meta.dirname`, so scripts work from any cwd):

```
data/texts, data/theographic, ...   raw downloads (gitignored)
data/processed/*.json               importer output + _metadata/ audit files
static/data/*.json                  what the app actually fetches (gitignored)
```

The full run is `pnpm --dir packages/data-pipeline run setup`, which chains: texts → theographic → enrichment → cross-references → genealogy → lexicon → naves → copy. **The ordering is load-bearing**: person enrichment writes `bibleDataId` onto `persons.json`, which the genealogy importer then reads for exact-ID resolution. From the repo root, `pnpm run data:all` (or the per-stage `data:*` scripts) delegate into the pipeline.

### Stage 1: fetch

One fetch script per upstream source. All support `--force`; without it they skip files that already exist, but still re-verify checksums on the skip path, so a stale or corrupt local file is caught either way.

| Source | What we take | License | Feeds |
|---|---|---|---|
| CrossWire KJV (GitLab) | `kjva.osis.xml` (Apocrypha edition, Strong's-tagged) | PD text, free tagging | KJV verses + lemmas/alignment |
| open-bibles (GitHub) | OEB OSIS | CC-BY-4.0 | OEB verses (NT + partial OT) |
| eBible.org | WEB, ASV, BSB, YLT, DBY USFX | Public domain | verses (+ lemmas/alignment where tagged) |
| morphhb / OSHB (GitHub) | WLC XML + `VerseMap.xml` | CC-BY-4.0 | WEB OT Strong's derivation |
| Byzantine Majority Text (GitHub) | Strong's-tagged `.BP5` files | Public domain | WEB NT Strong's derivation |
| Theographic Bible Metadata | People/Places/Events/Easton CSVs | CC-BY-SA-4.0 | persons, places, events, dictionary |
| BibleData | Person, PersonLabel, PersonRelationship, HebrewStrongs CSVs | Open | person enrichment, genealogy supplement, Hebrew lexicon |
| OpenBible.info | geocoding `ancient.jsonl`; cross-references zip (~341K input rows, TSK-derived) | CC-BY-4.0 | place coordinates; cross-references |
| OT-NT-Reference-Map, UBS Parallel Passages | typed reference overlays | BSD-2 / CC-BY-SA-4.0 | cross-reference type classification |
| OpenScriptures Strong's | Greek dictionary JS | CC-BY-SA-3.0 | Greek lexicon |
| CrossWire Nave's (SWORD module) | `Nave.zip` | Public domain | topics |

Note: WEB is currently fetched from a pinned copy hosted as a GitHub release asset rather than live eBible, because eBible replaced the WEB build in place with a reworded edition that fails our golden tests (issue #213 tracks adopting it).

**Reproducibility has three complementary mechanisms:**

1. **Commit pinning** - every GitHub/GitLab source is fetched via a commit-SHA raw URL. The SHA is a constant at the top of the fetch script (with a `Bump:` comment giving the `gh api` command to update it) and is mirrored into the source registry.
2. **SHA-256 acceptance for unpinnable hosts** (eBible.org, a.openbible.info, crosswire.org serve latest-build-only). `src/core/source-checksums.ts` is a generated lock file mapping each file to `{ sha256, accepted: date }`; `src/core/checksums.ts` verifies every unpinnable download against it and throws with remediation text on mismatch. When an upstream refresh is reviewed and approved, `pnpm run checksums:update` regenerates the lock (unchanged hashes keep their original `accepted` date).
3. **Import-run audit trail** - `src/core/import-runs.ts` appends `{ id, sourceIds, timestamp, pipelineVersion (git HEAD), inputFiles, stats }` to `data/processed/_metadata/import-runs.json` on every importer run. Source IDs must exist in the registry or it throws, so license audits can always attribute output to registered sources. Build-time only, never shipped.

The **source registry** (`src/core/source-registry.ts`) is the canonical catalog: every dataset with its license, URL, domain coverage, precedence tier, and pinned version.

### Stage 2: import and transform

**Bible texts.** Two importers share one output shape, `RawVerse { translation, book, chapter, verse, verseEnd?, osisId, text, lemmas?, align?, wj? }`:

- `importers/import-osis.ts` handles KJV and OEB (verse text between `<verse sID>`/`<verse eID>` milestones, tolerant of both attribute orderings).
- `importers/import-usfx.ts` handles the eBible translations (`<c id>`/`<v id>`...`<ve/>`; USFM book codes mapped to OSIS; bridged verses like `<v id="15-16"/>` produce `verseEnd`).

Both strip footnote/cross-reference note elements (`f`, `fe`, `x`) entirely and unwrap formatting tags (`add`, `wj`, `nd`, ...) with no replacement so punctuation stays attached to words. Strong's handling:

- `lemmas` - space-separated normalized Strong's tokens (`H7225 G2316`) extracted from `<w lemma>`/`<w s>` attributes. Powers Strong's search.
- `align` - character-offset spans `[start, end, "H7225"]` into the final verse text, produced by a mirror walk of the raw XML run in parallel with the plain-text extraction. If the walk's text ever drifts from the plain extraction, alignment is dropped for that verse (lemmas kept) and counted in a warning. The invariant: a walk bug can lose alignment, but can never corrupt verse text or attach a Strong's number to the wrong word. Powers word-level lemma grouping in Word Study.
- `wj` - words-of-Jesus offset ranges (WEB only).

**WEB Strong's derivation** (`derive-web-strongs.ts` + `importers/derive-strongs.ts`). WEB has no inline tagging upstream, so lemmas are derived from the original-language texts: OT from morphhb's WLC using both `VerseMap.xml` whole-verse remaps and morphhb's inline KJV boundary notes for sub-verse precision (Psalm superscriptions, straddling verses); NT from the Byzantine text, whose versification matches WEB directly. The derivation patches `web-verses.json` in place, never overwrites existing lemmas, and emits verse-level `lemmas` only - never alignment spans (so WEB is `strongs` but not `aligned`).

**Validation.** `validate:texts` runs corpus-wide invariants over every translation at the end of `import:all` and fails the pipeline on any hard error (issue #321). Structure: duplicates, book ids core `BOOKS` does not know (the canon table is derived from it, so an importer cannot strand a book the client cannot reach), every book a pinned source is known to contain (`EXPECTED_BOOKS`, so a whole book cannot vanish unseen), empty verses, verse gaps and trailing gaps not in the translation's source-verified omission list, bridge inversion, overlap and range, chapter counts against the KJV versification table. Text shape: markup or note residue, detached punctuation (#175 class), Psalm superscription text or lemmas in verse 1 (#176 class), lemma token format, and word-alignment spans (in bounds, ordered, tokens in the lemma bag). Source-inherent exceptions live in named allowlists with the verification date (`KNOWN_VERSE_GAPS`, `KNOWN_DETACHED_PUNCTUATION`, `KNOWN_TITLE_LEMMA_LEAKS`), each naming the exact anomaly (the ref and the occurrence or token), so a new defect in an already-listed verse still fails. Alignment spans are sparse by design, so there is no full-reconstruction check; the importers' mirror walk guarantees offsets were derived against the final text. Missing chapters and chapters running past the reference count stay warnings because partial translations and versification variants are legitimate. The report in `_metadata/text-validation.json` lists each invariant that fired with a count, plus verse counts per book. The reference table (`src/core/kjv-versification.ts`) is generated by `generate:versification` from the raw KJV OSIS - deliberately not from importer output, so an importer bug cannot bake itself into the reference data. On top of that, `src/golden-texts.test.ts` asserts exact text, lemma, and alignment content for anchor verses per translation through `core/golden.ts` - this is what catches silent upstream rewording (#213), and the checker itself is unit tested against a reworded fixture. One regression fixture per historical importer failure lives beside the importer it guards (#175, #176, #177, #183 and the stranded-book guard in the importer tests).

**Entities.** `importers/import-theographic.ts` parses the Theographic CSVs into `persons/places/events/dictionary.json`, each record carrying `sources: SourceRef[]` provenance. Two enrichment passes then rewrite the JSON in place:

- `enrich-places.ts` matches OpenBible geocodes onto Theographic places with distance-drift guards (100 km drift threshold, 25 km corroboration radius, precision-based confidence scoring).
- `enrich-persons.ts` links BibleData person records via a staged resolver (`id-direct` → `name-unique` → `id-discriminant` → `label-fallback` → `base-name` → `genealogy-context`), writing `bibleDataId` onto matched persons.

Both use the shared `entity-resolver.ts` (`ResolutionMap` with confidence scores) and `conflict-store.ts` (competing claims preserved, never silently merged) and emit `_metadata/resolution-map.json` / `_metadata/conflicts.json` for audit.

**Genealogy** (`importers/import-genealogy.ts`), four stages:

1. Primary edges from Theographic People.csv family columns (father/mother/partners/children/siblings) - already in the app's ID space, so same-named people cannot be conflated.
2. Exact-ID map from the enriched `persons.json` (`bibleDataId`), dropping low-confidence uncorroborated links.
3. BibleData supplement, admitted only for relationship types Theographic doesn't model (`ancestor-of`, `half-sibling-same-father`) and only when both endpoints resolve exactly - no name-based fallback.
4. Divine-edge exclusion (`god_1324`), so God is not the apex of every ancestry walk via Luke 3:38.

**Cross-references** (`importers/import-cross-references.ts`). Parses the OpenBible `from\tto\tvotes` dump (ranges collapsed to start verse, non-positive votes dropped) and classifies each edge in three tiers: (1) typed overlay lookup - verse-pair key first, then chapter-pair - built from OT-NT-Reference-Map and UBS Parallel Passages; (2) vote-based structural heuristics; (3) a relaxed fallback for low-vote edges instead of leaving them `unclassified`.

**Lexicon and topics.** Hebrew Strong's from BibleData CSV, Greek from the OpenScriptures dictionary → `lexicon-hebrew.json` / `lexicon-greek.json`. Nave's Topical Bible is read directly from the SWORD zLD binary format (`import-naves.ts`: `dict.zdx` offset index → zlib-inflated `dict.zdt` blocks → TEI entries) into `TopicRecord { id, name, sections, refCount, seeAlso }`.

### Stage 3: copy to static, with splitting

`copy-to-static.ts` publishes every dataset in `core/dataset-registry.ts` from `data/processed/` to `static/data/` and writes `static/data/manifest.json` describing them (issue #311, decision D1). The registry is the single owner of what ships: translation entries also carry the catalog metadata (name, license, `strongs`/`aligned`/`coverage`) that the client reads at boot, so adding a translation touches the registry and its importer, nothing in `src/`.

Each manifest entry carries `id` (`translation:kjv`, `cross-references`, `lexicon-hebrew`, ...), `version`, `contentHash`, `recordCount`, `files[]` and, for translations, per-book verse counts. The hash is taken over the processed file before any split, so it is stable whatever the part layout, and the version is derived from the hash, so regenerating from identical inputs produces an identical manifest. Identity is `id + version + contentHash`; counts are a sanity check only. Cloudflare Pages rejects files over 25 MB, so any JSON over a 20 MB threshold is split into byte-budgeted parts (~15 MB each) listed in `files[]`; currently ASV and DBY verses (2 parts each) and cross-references (3 parts). After publishing, any JSON file the manifest does not vouch for is removed and the manifest is validated (every entry resolves to real files, no orphans, no duplicates). The published identities are appended to the import-run ledger.

`static/data/` is **gitignored**. Every deploy must run the pipeline: the `deploy.yml` workflow caches the raw `data/texts` + `data/theographic` downloads (keyed on the fetch scripts' hashes), runs the full `setup`, builds, and deploys to Cloudflare Pages.

## Runtime data layer (Dexie)

`packages/db` is split by domain (issue #320, decision D9). `database.ts` defines `CodexDB` (database name `codex-scriptura`) and the one instance; `schema.ts` holds every table definition and migration, currently at **schema version 30**; `index.ts` is a barrel and the app imports everything from `@codex-scriptura/db`. Query modules follow the tables: `verses.ts`, `translations.ts`, `preferences.ts` (settings and kv), `annotations.ts` (annotations, themes, tags), `saved-searches.ts`, `word-search.ts`, `entities.ts`, `search-indexes.ts`, `cross-references.ts`, `topics.ts`, `lexicon.ts`, `strongs.ts`, `relationships.ts` and `datasets.ts`, each with its test beside it. There is deliberately no repository interface or injection layer: the package is already the data-access boundary. Tables:

| Table | Key indexes | Notes |
|---|---|---|
| `verses` | `id, translationId, [translationId+book+chapter], [translationId+osisId]` | id = `${translationId}.${osisId}`; carries `text`, optional `lemmas`, `align`, `wj`, `verseEnd` |
| `translations` | `id` | metadata incl. `strongs` / `aligned` / `coverage` flags |
| `annotations` | `id, type, book, verseStart, verseEnd, *tags, created, modified` | highlight, note, bookmark, memorization, theme |
| `tags` | `id, name` | user taxonomy for annotations |
| `settings` | `id` | single `'default'` record: `UserPreferences` |
| `savedSearches` | `id, created` | persisted searches |
| `persons` / `places` / `events` | `id, name, *verseRefs` (+ `lat, lng` on places) | Theographic entities; multi-entry `*verseRefs` gives reverse lookup ("who appears in this chapter?") |
| `dictionary` | `id, term` | Easton's |
| `searchIndexes` | `id, translationId` | serialized MiniSearch indexes, invalidated by verse-count mismatch |
| `crossReferences` | `id, sourceVerse, targetVerse` | ~299K rows, one per undirected pair since v29 |
| `relationships` | `id, personFrom, personTo, type, [personFrom+type], [personTo+type]` | genealogy edges |
| `lexicon` | `id, strongsNumber, language, lemma` | Strong's Hebrew + Greek |
| `topics` | `id, name` | Nave's |
| `kv` | `id` | generic singletons: `navHistory`, `splitPanes`, `scratchPad`, `whatsNewSeen` |
| `datasets` | `id` | one `InstalledDataset` row per installed dataset: manifest id, `version`, `contentHash`, `installedAt`, `recordCount` (v30, issue #310) |

**Two versioning mechanisms, kept apart** ([architecture-decisions.md](architecture-decisions.md) D1):

- **Schema version** (Dexie `version(n)`): moves only when the storage shape changes - a new table, an index, a settings-shape migration. All versions are declared inline in the constructor; additive `.stores()` calls introduce tables and indexes, `.upgrade()` transactions migrate shapes. Blocked upgrades (another tab holding the old version open) are surfaced on the boot screen via `db.on('blocked')`.
- **Dataset version** (`datasets` table + `/data/manifest.json`): decides when a dataset re-seeds. Identity is `id + version + contentHash`; on every boot each seeder compares its row with the manifest entry (`packages/db/src/datasets.ts`) and replaces only a `missing`, `stale` or `legacy` copy: the old rows and the identity row go in a first transaction, each part lands in its own, and the identity row is written last. The identity row is the receipt for a complete install; an interruption leaves none, so the dataset reads `missing` and is reinstalled next boot. The previous copy does not survive a failed replacement (a deliberate trade for never holding a dataset twice in memory); consistency is guaranteed, availability rollback is not. Correcting a dataset therefore ships as a new manifest version with no schema bump, and one translation can be installed, removed or refreshed without touching the others.

Versions 1 to 29 predate the split: roughly two thirds of them exist only to clear a table so a count-based seed gate re-fired after a pipeline fix. v30 is the last of that kind: it adds `datasets` and backfills one row per dataset the profile already held with `version: "legacy"` and a null hash, so every legacy row mismatches the manifest once and is replaced; after the following boot no legacy row remains. User-writable tables (`annotations`, `tags`, `settings`, `kv`, `savedSearches`) are never read or cleared by reconciliation.

## Client seeding (first boot)

`src/lib/seed.ts`, driven from `onMount` in `src/routes/+layout.svelte`. Boot has two phases (issues #168, #244): the reader opens as soon as its own data is in, and everything else streams in behind the live app.

1. Best-effort `navigator.storage.persist()`, load preferences (the active translation decides what is boot-critical), then `seedCritical()`: fetch `/data/manifest.json`, upsert the translation catalog, install the active or default translation. `ready` flips, the What's New check runs, and `seedEnhancements()` continues without being awaited: the other wanted translations, cross-references, the Theographic entities, genealogy, the lexicon and the topical index, sequentially. Any throw before `ready` renders a retry screen instead of an infinite spinner; a failure after it is a banner.
2. **Seeding is gated per dataset by manifest comparison** (`getDatasetState(entry)` against the `datasets` row), not a global flag or a row count. `current` skips; `missing`, `stale` and `legacy` install. The receipt is also what "installed" means elsewhere: `getInstalledTranslationIds()` reads receipts, never verse rows, so an interrupted replacement is not listed. `seedCritical` throws (the layout shows the retry screen) unless at least one wanted translation holds a complete receipt; with the manifest unreachable it opens on whatever is already installed. Boot refresh, on-demand install and removal of one translation serialize through a per-translation lock, so a removal that arrives during a background install waits for it and wins. The boot plan is a snapshot, so the background refresh re-reads the wanted set inside that lock and skips a translation removed before the loop reached it; removal wins in both orderings.
3. **Every dataset streams part by part.** `manifestSource` (`src/lib/dataset-stream.ts`) yields one split file at a time, prefetching the next while the current one inserts, and spot-checks each part's first record against the keys the dataset must carry. `installDatasetStream` (`packages/db/src/datasets.ts`) clears the previous copy and its identity row in a first transaction, writes each part in its own transaction, and records the identity last, so a 37 MB dataset is never held twice and an interruption leaves it `missing` for the next boot rather than half-trusted. The part iterable is the transport seam: a `.csdata` reader (v0.6.0) yields the same shape.
4. The translation catalog (id, license, `strongs`/`aligned`/`coverage` flags) is read from the manifest's `translation:*` entries; the pipeline's dataset registry owns it. **Only the wanted set seeds** (kv key `wantedTranslations`; fresh profiles default to KJV, pre-feature profiles grandfather everything already installed); the rest download on demand via `installTranslation()` from the Settings Library, and `removeTranslation()` reclaims storage. Catalog metadata for every entry, installed or not, is re-`put` on each boot.
5. **Installed state is reactive.** `datasetStatus` (`src/lib/stores/datasetStatus.svelte.ts`) combines a Dexie live query on the `datasets` table with the boot plan and in-flight progress, so `state(id)` answers `installed`, `loading`, `failed` or `absent` for any dataset and flips the moment an identity row lands. The first-run screen lists every dataset this boot installs with its size and progress; after the reader is live a neutral strip above the content shows what is still coming. Features that need an enhancement dataset go through `DatasetGate` (Skeleton while loading, InlineError with `retryDataset(id)` when failed, EmptyState when absent) or re-run their query on `datasetStatus.isInstalled(id)`: cross-reference pills, entity marks, the Who's here panel, the topical search and the graph's link matrix all light up without a reload. Failures surface through `seedStatus` as before, and a retry re-runs that one dataset rather than reloading the page.

## Application architecture

### Routes

`/` redirects to `/read`. The other routes: `/read` (reader workspace), `/search`, `/graph`, `/themes`, `/settings`. `+layout.svelte` is the app shell: boot/seed screen, sidebar nav, theme and CSS-custom-property projection, and globally mounted overlays (`CommandPalette`, `GenealogyTreeModal`, `WhatsNewModal`).

### Reader workspace and split view

- `ReaderWorkspace.svelte` owns pane orchestration: the split layout (1-3 panes, draggable dividers via flex weights, 280 px minimum pane width), sync scroll (proportional 0-1 fraction, never raw pixels - panes showing different books have different heights), the annotation sidebar, scratch pad, navigation history, URL sync (`?book=&chapter=`), and keyboard shortcuts (Alt+Left back, Cmd/Ctrl+\ split, Cmd/Ctrl+Shift+P scratch pad).
- `ReaderPane.svelte` is one self-contained reader instance: verse HTML rendering (entity marks, words of Jesus, divergence shading, highlights), selection and annotation actions, inline cross-reference badges, double-click word → dictionary lookup cascade (entity → Easton's → search fallback), drag-verse-to-scratch-pad. It exposes a small imperative API (`flashVerse`, scroll fraction/anchor accessors) to the workspace.
- `StudyRail.svelte` + `stores/studyRail.svelte.ts` (`StudyRailState`, one per `PaneState`) is the pane's single side column: every panel (Who's here, entity detail, word lookup, lineage, plugin) is a resident tab with its state in the tab payload; four tabs max, LRU eviction, tabs survive chapter loads. `ReaderPane` renders each kind's component inside the rail's content snippet.
- **`PaneState`** (`src/lib/stores/splitPanes.svelte.ts`) is the unit of reader state: a runes class holding location, loaded verses, enrichment, annotations, selection, and panel mode, plus all navigation actions. Every pane, including the primary, is a `PaneState`; workspace-specific concerns (nav history, URL sync, preference persistence for pane 0; split-layout persistence for extra panes) attach via `onBeforeNavigate`/`onAfterNavigate` hooks. Pane layout persists to the Dexie `kv` table under `splitPanes`.
- Cross-translation **divergence** (`src/lib/engines/divergence.ts`) does token-level comparison chunked across animation frames, memoized by chapter + content signature.
- The **scratch pad** is workspace-level and deliberately not verse-anchored: one persistent `kv` record holding free text with dropped-verse blocks interleaved; a selection can be promoted non-destructively into a real `Annotation`.

### Search

Three modes on `/search`, plus the Cmd+K command palette:

- **Full text** - MiniSearch per translation (fields `text` + `lemmas`, prefix and length-dependent fuzzy matching, stop words, exact-phrase re-ranking, testament filter, merged across selected translations). Serialized indexes are cached in the `searchIndexes` table and invalidated by verse-count mismatch, so they rebuild only after a re-seed.
- **Word Study** (concordance) - exhaustive DB-side scans in `packages/db`: whole-word regex search with optional archaic-variant stemming; `strongsSearch` for `H7225`-style queries over `verse.lemmas`; and `lemmaGroupSearch`, which uses the `align` spans to group English surface forms by underlying Strong's lemma (gated on `Translation.aligned`). Lexicon entries (`searchLexicon`, diacritic-folded) render alongside.
- **Topics** - Nave's lookup over the `topics` table with a memoized index.
- The **command palette** keeps its own lighter MiniSearch index (same cache table) and resolves reference parses (`parseReference` from `core`) into direct jumps.

### Graph

The graph data model (namespaced node IDs like `verse:Gen.1.1`, `person:moses_1`; typed edges) lives in `packages/core/src/graph.ts` and is renderer-independent. Traversal engines live in `src/lib/engines/` and read Dexie directly; core never touches the DB.

- **Canon ring** (`/graph`, `engines/canonRing.ts`) - all 66 books on a circle in canonical sections, edge thickness from `getBookCrossReferenceMatrix()` (full ~300K-row scan, cached - it only changes after a re-seed; slated to move to build time under #38 and #167), capped at the 300 strongest edges.
- **Neighborhood graph** (`engines/graph.ts`) - bounded BFS from a seed node over stored cross-reference edges plus entity-mention edges **synthesized on demand** from `verseRefs` arrays (never materialized as rows - they are already implicit and indexed; storing them would mean ~2M redundant rows). Entity nodes are terminal leaves so a heavily-mentioned person doesn't explode the frontier. A hard node cap (default 120) is enforced in the engine, not the UI.
- **Genealogy** - `engines/familyTree.ts` builds the full family graph (~1,700 people) from the `relationships` table for the tree modal with a tidy generational layout; `LineageRail` in the reader uses a small static Genesis-10 Table of Nations dataset for the inline lineage peek.

### State management

Runes-based module singletons in `src/lib/stores/*.svelte.ts`, in two idioms: closure factories returning getter objects (`preferences`, `navHistory`, `scratchPad`, `seedStatus`) and classes with `$state` fields (`ui`, `PaneState`). Recurring patterns worth knowing before touching state code:

- **`$state.snapshot()` before every IndexedDB write** - deep-reactive proxies throw `DataCloneError` in structured clone.
- **Debounced persistence** (500 ms) for preferences and scratch pad; fire-and-forget `setKv` for layout.
- **One-shot request counters** (`ui.commandPaletteRequest`, `ui.notePrefill.request`) instead of booleans, to avoid `$effect` write-loops.
- **Generation counters** as async race guards on chapter loads and graph builds.
- **Dexie `liveQuery` bridged into runes**: `observeAnnotationsForBook()` streams annotation changes into `PaneState`, replacing manual reload logic.
- **Preferences project into CSS custom properties** (accent family, fonts, density) via a single `$effect` in the layout - components style off variables, never off preference state directly.
- **Persistence tiers**: typed `settings` table for `UserPreferences` only; `kv` table for every other singleton; `localStorage` for nothing new (the Study Rail width is `studyRailWidth` in preferences); session-only module state for the rest.

## Offline / PWA

`src/service-worker.ts` is SvelteKit-native (no Workbox), with the cache decision logic split into a pure, unit-tested module (`src/lib/sw/cache-strategy.ts`).

- **install**: precache all build assets, static files, and prerendered pages, plus a best-effort cache of the `/index.html` SPA fallback (it is in neither list, and offline deep links would 404 without it). `skipWaiting()`. The `/data/*.json` seeds are deliberately excluded (issue #163): they are consumed once by seeding into IndexedDB, precaching stored all scripture twice and re-downloaded ~148MB on every deploy, and a re-seed after a Dexie bump needs fresh data, not a cached copy. Data fetches route as passthrough.
- **activate**: delete non-current versioned caches, `clients.claim()`.
- **fetch** routing via `planRequest(pathname, mode, assetPaths)`:
  - precached asset → cache-first, network fallback, re-cached only if the response is genuinely cacheable (200 and not `text/html`);
  - navigation → network-first with offline fallback to the cached shell, never runtime-cached;
  - everything else → passthrough, cache untouched.

  The `text/html` guard and the passthrough branch encode a real production fix (issue #145): Cloudflare Pages answers missing asset paths with the SPA fallback at HTTP 200, and caching that HTML under a stale script URL wedged the app in a reload loop.

Dev caveat: the dev service worker serves stale modules - the verify skill (`.claude/skills/verify`) blocks it when testing in a browser.

## Plugin architecture

**Designed, not yet implemented.** There is no runtime plugin loader; `packages/plugin-api` is an empty stub and `plugins/example-votd` is a placeholder. Extensibility arrives in two steps ([architecture-decisions.md](architecture-decisions.md) D5 to D8, D12): v0.6.0 Resource Ecosystem ships `.csdata` resource packages, which carry content and no code, and v1.1.0 Executable Plugin Runtime ships executable plugins in two trust tiers, first-party in-process and third-party sandboxed, both against one serializable async API. The contract is drafted in [plugin-api.md](plugin-api.md) and the core / resource / plugin boundary in [core-vs-plugins.md](core-vs-plugins.md).

The seams that already exist and will become extension points: the `PaneState` navigation hooks, the engines-vs-components split (engines return typed data any renderer can consume - the genealogy and graph renderers are explicitly designed to be replaceable), and the planned `registerPreferenceSchema` for settings panels.

## CI / deployment

- `ci.yml` (push/PR to `main` and `develop`): svelte-check, Vitest, build.
- `deploy.yml` (push to `main`): restores the raw-source cache, runs the full data pipeline `setup`, builds, and deploys `build/` to Cloudflare Pages via wrangler.
- `release.yml` (tag `v*.*.*`): check + build + GitHub release with generated notes.

Branching follows the two-branch flow in [branching-strategy.md](branching-strategy.md): feature PRs squash-merge to `develop`; releases are `develop` → `main` merge commits.
