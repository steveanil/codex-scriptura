# Project Roadmap

Codex Scriptura is being built iteratively in a vertical slice approach. Instead of building the entire backend before touching the UI, we build self-contained, usable milestones.

## Release Status (as of 2026-07-16)

Tagging fell behind development. Current state:

- **Latest tag and GitHub Release: `v0.3.2`** (2026-04-01). All `package.json` versions still read `0.3.2` (`plugin-api` reads `0.3.0` and is out of step with the rest of the monorepo).
- **26 commits sit on `main` untagged**, all of it v0.4.0-milestone work: the graph engine and view, the genealogy viewer and importer rewrite, split-view panes, verse hover previews, quotation badges, cross-reference and lexicon importers, and the vitest harness plus CI.
- The v0.4.1 hardening work (footnote fix, versification validation, seeding and navigation fixes) lives on the `fix/known-issues-hardening` branch, not yet merged.

**Decision (2026-07-16): no catch-up patch.** Everything on `main` since `v0.3.2`, plus the hardening branch, ships together as **`v0.4.0`** when the milestone's remaining items are done and [known-issues.md](known-issues.md) is cleared. Anything from the "v0.4.1" section merged before that tag ships inside `v0.4.0`; the section numbers below are planning buckets, and the real version number is assigned at tag time. After `v0.4.0`, return to the [release-process.md](release-process.md) cadence: tag a patch after each feature PR merges instead of batching.

## The Path to 1.0

### `v0.1.0`: Foundation
- [x] Monorepo structure (`core`, `db`, `data-pipeline`).
- [x] OSIS/USFX text importers (KJV, WEB, OEB).
- [x] SvelteKit PWA App Shell.
- [x] Offline-first IndexedDB via Dexie.js.
- [x] Basic Bible reader and canonical lists.
- [x] MiniSearch exact & fuzzy full-text search.
- [x] Service worker caching (offline capability).

### `v0.2.0`: Annotate
- [x] Highlight UI with multi-color support.
- [x] Rich text note editor attached to passage ranges.
- [x] Hierarchy tagging system for notes and bookmarks.
- [x] Annotation persistence in Dexie.js.
- [x] **Command Palette (Cmd+K):** Primary search entry; instant verse, word, book, or note jump without page transitions.
- [x] **Advanced Search Route (`/search`):** Refactored as a power-user destination for heavy filtering, saved searches, and multi-translation comparisons.

### `v0.2.1`: Annotation Navigation (Patch)
- [x] **Bugfix:** Resolve sidebar state desync where `chapterAnnotations` retains stale data after chapter navigation.
- [x] **Navigation Infrastructure:** `scrollToVerse(osisId)` utility and `verse-flash` CSS keyframe implemented in `src/lib/utils/navigation.ts`. Jump-to-verse actions from the Cmd+K palette and `/search` results scroll the target verse into view and apply a 1.4s accent-color flash for instant visual orientation. No database state involved - transient CSS animation only.
- [x] **Feature:** Clickable annotation routing - wire "All Annotations" sidebar entries to `goto()` + `scrollToVerse()`, reusing the existing flash infrastructure.
- [x] **Feature:** Highlight and annotation deletion (undo accidental highlights directly from the verse popup and the sidebar).
- [x] **UI Pattern:** Split annotation sidebar into "Current Chapter" vs "All Annotations" tabs.

### `v0.3.0`: Personalize & Enrich
*Status: Complete. Morphology/Strong's search items moved to v0.4.0 - see note below.*

**Done:**
- [x] **User Preferences:** Theme switching (light/dark/system), custom accent colors, and highlight preset management - fully wired to Dexie `Settings` table via `preferences.svelte.ts`.
- [x] **Typography & Layout:** Font selection (reader/UI fonts), font-size slider, layout density (compact/normal/relaxed), column width, line height - all proxied into root CSS custom properties via `$effect`.
- [x] **Settings Route (`/settings`):** Dedicated preferences UI with appearance, typography, reader, and highlight preset panels.
- [x] **Data Pipeline:** CSV→Dexie ingestion pipeline for `persons`, `places`, `events`, and `dictionary` tables (`import-theographic.ts`, `fetch-theographic.ts`, `copy-to-static.ts`). Full `setup:theographic` npm script.
- [x] **"Who's Here?" Panel:** Entity panel in the reader showing persons, places, and events mentioned in the current chapter. Entities highlighted inline in verse text via colored underlines.
- [x] **Person / Place / Event Explorer:** `EntityDetailPanel.svelte` shows bio, verse refs (current chapter + elsewhere count), geocoding confidence for places, and formatted dates for events.
- [x] **Easton's Bible Dictionary:** Inline definitions surfaced from the `dictionary` Dexie table within entity detail panels.
- [x] **Concordance (Word Study) Search:** Exhaustive exact-word scan with inflection variant matching (loved/loves/loveth). Canonical result ordering with hit counts and surface forms.
- [x] **Name Meanings:** Hebrew/Greek etymology inline via BibleData PersonLabel dataset.
- [x] **Data Pipeline:** `enrich-places-openbible.ts` - join OpenBible GPS coordinates into `places.json` seed for higher-confidence geocoding.
- [x] **Groundwork (Split view prerequisite):** Refactored the monolithic chapter view out of `read/+page.svelte` into prop-driven `ReaderPane.svelte` (scripture rendering, verse selection, entity panels, selection toolbar) and `ReaderWorkspace.svelte` (header navigation, data loading, annotation sidebar orchestration). Route is now a thin wrapper. Architecture supports future multi-pane rendering.

**Deferred to v0.4.0 (data dependency):**
- Strong's number search and morphology-aware search were originally scoped here but have been blocked since the start of v0.3.0. All code infrastructure is in place (`extractLemmas()` in both importers, `VerseRecord.lemmas` field, `ConcordanceSearchMode: 'lexical'` type, MiniSearch lemma indexing). The blocker is purely data: current KJV/OEB/WEB source texts contain no `<w lemma="...">` markup. These features are now consolidated under v0.4.0 where the BibleData Strong's CSV imports are already planned.

### `v0.3.1`: Navigation & Polish (Patch)
*Status: Complete as of 2026-03-28.*

- [x] Fix the flash animation infrastructure on verses when you jump to them.
- [x] **UX Audit:** Verify `verse-flash` fires consistently from all jump-to-verse entry points: Cmd+K palette results, `/search` result clicks, and annotation sidebar navigation.
- [x] **Fix:** Command palette searches hardcoded KJV only; should index the user's active translation instead.
- [x] **Performance:** MiniSearch index rebuilt from IndexedDB every browser session. Cache serialized index in IndexedDB between sessions to eliminate cold-start latency on repeat visits.
- [x] **Navigation History Trail:** In-session reading history stored as a stack of `{ book, chapter, verseId, scrollTop }` tuples, persisted to Dexie `Settings` under key `'navHistory'`. Displayed as a compact breadcrumb strip at the bottom of the reader (e.g. Gen 1 → John 1 → Rom 8). Alt+← ("Return") shortcut pops the stack and restores the previous position including scroll offset. Clears on tab close; depth cap of ~50 entries.
- [x] **Paragraph mode toggle:** Reader preference rendering verse text as flowing prose paragraphs. Toggled in the reader toolbar; persisted in `UserPreferences`. Verse number superscripts remain inline.
- [x] **Red letter mode:** Reader preference rendering words of Jesus in red. Sourced from `<wj>` markup in the WEB USFX source; toggle disabled gracefully for translations without markup. Toggled in Settings → Reader.
- [x] **Reading time estimate:** "~N min read" displayed in the chapter navigation bar, calculated from verse count × reading velocity (default 200 wpm, adjustable in Settings).
- [x] **Dictionary lookup on double-click:** Double-clicking any word in verse text opens the entity detail panel with the best available match. Lookup cascade: (1) Theographic entity → rich entity card; (2) Easton's Bible Dictionary → definition card; (3) fallback → minimal card with "Search in Bible" link. Word normalization handles inflected forms.

### `v0.3.2`: Bug Fixes & Contributor Setup (Patch)
*Status: Complete as of 2026-04-01.*

- [x] **Fix:** Remove paragraph mode toggle from reader toolbar - this control belongs in Settings (where it already lives); no dead UI references remain.
- [x] **Fix:** Navigation history rewritten from a push-stack to a unique-entries trail with a "you are here" cursor. Navigating to a chapter already in the trail highlights it in place instead of duplicating it. Bounded at 6 unique entries; back-navigation (Alt+←) is now temporally accurate via a separate `backStack`.
- [x] **Fix:** Verse selection range bug - clicking verse 10 then verse 14 no longer creates a highlight spanning verses 10–14. Annotations are now created per contiguous group of selected verses, so non-adjacent clicks produce precise, non-overlapping highlights.
- [x] **DX:** Automated data fetch for contributor onboarding - `pnpm setup:data` downloads all public-domain Bible text XMLs (KJV, OEB from GitHub; WEB from eBible.org) and Theographic metadata. No manual file downloads required to run the project locally.

### `v0.4.0`: Deep Study (Connect & Graph)
*Status: In progress - graph view, genealogy viewer, split view (pane tiling), verse hover previews, quotation badges, the basic lexicon lookup tab, and all data imports are complete, and the entire known-issues backlog (#13-#35) is closed in PR #17 (`fix/hardening-closeout`, open as of 2026-07-18). Remaining: Strong's search (data acquisition), graph enrichment, theme threading, scratch pad, semantic search, maps, and split-view completion (sync scroll, toolbar, dividers). **Unreleased:** completed items are on `main` (or in PR #17) but untagged; the latest release is still `v0.3.2` (see Release Status above).*

- [x] Cross-reference schema and importer. Typed edges (`quotation`/`allusion`/`parallel`) classified via overlay datasets (OT-NT-Reference-Map, UBS Parallel Passages).
- [x] **Graph View (Zoomable Scripture Graph):** Interactive visualization of scriptural links with **progressive disclosure** - the graph must never dump all verse-level connections at once. Instead, it reveals complexity in layers as the user drills down:
  - **Zoomed out (book/section level):** Clustered nodes representing books or major sections, with weighted edges showing density of cross-references between them. Entry point for orientation - "where does Romans connect to?"
  - **Mid zoom (chapter/passage level):** Expand a cluster to see chapter-level or passage-group nodes. Major cross-reference relationships become visible. Clicking a cluster opens it; double-clicking collapses it back.
  - **Zoomed in (verse level):** Individual verses as nodes with direct connection edges. This level only renders for the currently focused cluster - never globally. Clicking any verse node opens/navigates to that passage in the reader.
  - **Hover preview:** Hovering a node at any zoom level shows a floating card with the passage text (reuses the verse hover preview infrastructure).
  - **Filtering:** Users filter by edge type (quotation, allusion, thematic echo, shared keyword) and by entity linkage (person, place, event). Filters reduce visual noise before it appears, not after.
  - **Hard constraint:** The graph renderer must enforce a visible node cap (~120 nodes) with a "too many connections - zoom in or filter" message rather than rendering an unreadable hairball. This is a UX principle, not just a performance optimization.
  - **Implementation:** 1-hop default, depth slider, expand-on-click, typed edges. The graph data model and query engine are core; the rendering layer is a first-party plugin following the same conventions as the genealogy viewer.
- [x] **Verse hover preview:** Wikipedia-style inline preview for any verse reference - in cross-reference markers, entity detail panels, or user notes. Hovering a reference for ~400 ms shows a floating card with the verse text; no navigation required. Clicking the card navigates to the verse (pushing to the navigation history stack); Cmd+click opens it in a new split-view pane.
- [x] **Data Pipeline:** `importers/import-genealogy.ts` populates the `relationships` Dexie table - Theographic family columns as the primary source, BibleData `PersonRelationship.csv` as a strictly-resolved supplement (`ancestor-of`, `half-sibling-same-father`). Originally BibleData-primary via name matching; rewritten 2026-07 after name collapse produced multi-father children.
- [x] **Data Import:** Strong's lexicon datasets - Hebrew from BibleData `HebrewStrongs.csv` (`importers/import-hebrew-strongs.ts`), Greek from the OpenScriptures Strong's dictionary (`importers/import-greek-strongs.ts`) → `lexicon-hebrew.json`, `lexicon-greek.json`.
- [ ] **Search: Strong's Number Search** (e.g. H430 → Elohim) - activate `ConcordanceSearchMode: 'lexical'`. **The data blocker fell 2026-07-18:** the eBible.org expansion translations (ASV, BSB, DBY) ship word-level Strong's markup (`<w s="H7225">`), and the USFX importer now harvests it into `VerseRecord.lemmas` (~31K tagged verses per translation, both testaments). What remains is pure wiring: index `lemmas` in the concordance path and let a Strong's-number query hit it. KJV/WEB remain untagged; STEPBible TAHOT/TAGNT or the CrossWire KJV module (see [open-data-sources.md](open-data-sources.md#strongs-tagged-sources-unblocks-v040-strongs-search)) can tag the KJV later, but Strong's search no longer waits on them. This also unblocks the lexicon verse links and the search-evolution item below.
- [ ] **Graph Enrichment:** Add person→verse, place→verse, and event→verse edges to the knowledge graph.
- [x] **"Why is this quoted?":** When reading NT passages that quote the OT, a small inline badge appears at the quoting verse. Clicking the badge opens a popover showing the original OT source passage (with navigation and open-in-pane options). Makes OT quotations - Jesus citing Deuteronomy in Matthew 4, Paul citing Isaiah in Romans - immediately visible without requiring prior knowledge that the connection exists. Built on the `quotation` edge type from the typed cross-reference overlays.
- [ ] **Theme threading:** User-defined topical tagging - tag any verse with a theme label (e.g. "covenant", "resurrection", "faith") and view a thread of all verses tagged with that theme across the whole Bible, in canonical order with chapter context. Stored as a new annotation subtype (`type: 'theme'`) in the existing `Annotations` Dexie table - no schema change required. Thread view is a filtered display mode accessible from `/search` or a dedicated `/study/theme/:slug` route.
- [ ] **Scratch pad:** A floating persistent notepad at the workspace level, outside the verse/chapter system. Opened and dismissed with Cmd+Shift+P; slides in as a narrow panel that persists across chapter and book navigation. Persisted in Dexie `Settings` under a singleton key (same pattern as `UserPreferences`). While reading, any verse can be dragged - or sent via a "Send to scratch pad" button on the verse toolbar - and it drops in as a quoted block with the reference attached. A "Convert to note" button promotes a scratch pad selection into a proper anchored `Annotation`. The pad resets only when the user clears it manually, never on navigation.
- [x] **Split view:** Tile 1–3 reader panes side by side in a horizontal flex row, each independently navigable with its own book, chapter, and translation. *Shares this milestone with the Genealogy Viewer - the killer use case is Matthew 1 and Luke 3 open side by side.* As shipped (docs updated 2026-07-18 to match reality):
  - **Pane model:** every pane, including the primary, is a `PaneState` class instance (`stores/splitPanes.svelte.ts`) holding navigation state, loaded data, and navigation actions, with workspace hooks for history/persistence (known-issues #14). Minimum pane width 320 px; "+ split" hides at 3 panes.
  - **Persistence:** pane locations (`{ book, chapter, translation }`) live in the Dexie `kv` table under `'splitPanes'` (v18; migrated from localStorage) and survive reload, including extra-pane translation switches.
  - **Per-pane top bar:** book selector with coverage-aware greying, chapter pill strip, translation picker, close button (extra panes only).
  - **Entry points:** (1) the split icon in the main nav bar; (2) the "Open in split pane" button on cross-reference popovers.
- [ ] **Split view completion** - the sync-scroll toggle, workspace toolbar, draggable flex-basis dividers, a Cmd+\ shortcut, scroll-position persistence, and the parallel-translation preset (driving the existing `parallelTranslation` preference: same chapter, two panes, sync scroll on) are *not yet implemented* (July 2026 review; see [known-issues.md](known-issues.md) #13). Sync scroll, when built, should sync as a 0–1 fraction of scrollable height, never raw pixels, because panes have different content lengths.
- [ ] **Strong's Concordance integration** in the baseline WEB/KJV - depends on Strong's data import above.
- [x] **Lexicon lookups (basic):** the `/search` Lexicon tab surfaces Strong's numbers, lemmas, transliterations, glosses, and expandable definitions from the seeded `lexicon` table (searchable by ID, lemma, transliteration, or English gloss). The tab wears a "preview" badge and states its limitation honestly (known-issues #29): tap-through from an entry to its verses stays blocked on the same verse→Strong's mapping as Strong's number search, and lands via the search-evolution item below.
- [ ] **Pronunciation on lexicon cards** *(added 2026-07-18)*: show how to say the word, not just its transliteration. The data is already fetched: BibleData `HebrewStrongs.csv` embeds Strong's classic respellings in the gloss field ("ab (awb)", "dabar (daw-baw')") which `import-hebrew-strongs.ts parseGlossField` currently extracts past and discards; capture it into a `pronunciation` field on `LexiconEntry` and render it beside the transliteration. Greek: our OpenScriptures file carries accented transliterations (agapáō) whose accent marks the stressed syllable; render those as-is now, and pick up a public-domain Strong's Greek respelling set (ag-ap-ah'-o style) when one is sourced. Small importer + card change; ships with the lexicon lookup UI above.
- [ ] **Search evolution: fold Lexicon into Word Study once verse-level Strong's data lands** *(decided 2026-07-18)*. Today the three `/search` modes are disconnected because nothing links a verse to the Strong's numbers of its words; the Lexicon tab wears a "preview" badge for exactly this reason (known-issues #29). When the verse→Strong's data above arrives, Word Study upgrades from English surface forms to original-language word study: a query like "love" groups results by underlying lemma (agapao 143x, phileo 25x), and each lemma expands to every verse containing that Strong's number regardless of English rendering (chesed → mercy, kindness, lovingkindness). At that point the Lexicon tab stops being a separate destination: its entry cards become the group headers inside Word Study results, the standalone tab is retired (or kept as a thin alias), and the preview badge comes off. This is the Strong's Exhaustive Concordance workflow, not an interlinear; the interlinear is a reader feature and needs the word-aligned data listed under v0.5.0.
- [ ] **Search:** Semantic/topical search ("verses about forgiveness" via graph traversal metadata).
- [x] **Interactive Genealogy Viewer:** visualizes person relationships from the `relationships` Dexie table. Shipped design differs from the original spec below by deliberate decision (2026-07, cool-slate refresh): no standalone route, no D3.
  - **As shipped:** a tappable **lineage rail** (ancestor chain) inside `EntityDetailPanel`, plus a full-tree **popup modal** (`GenealogyTreeModal`) with a generation-depth slider, built on a custom tidy generational layout in `src/lib/engines/familyTree.ts`. The "Family tree" button only renders for persons who actually have genealogy links. Divine IDs are excluded from the tree entirely (God is not a family-tree node; known-issues #34).
  - **Superseded spec (kept for the record):** a bookmarkable `/study/person/:id` route with d3.tree and force-simulation modes was planned; the user chose the in-context modal instead. If a deep-exploration surface returns, it should reuse the familyTree engine, not reintroduce D3 for this.
  - **Plugin compatibility:** the engine and `relationships` table are core; the modal/rail are first-party UI that a plugin renderer could replace.
- [ ] **Maps:** Basic place map using place `lat`/`lng` data already in Dexie - render leaflet/maplibre tile map in `EntityDetailPanel` for places with geocoding confidence ≥ medium. *Highest-ratio feature remaining in this milestone: ~1,600 places with coordinates and confidence tiers are already seeded - the data work is 100% done; only the panel UI remains.*

### `v0.4.1`: Data Accuracy & Hardening (Patch)
*Full findings with file/line detail live in [known-issues.md](known-issues.md). Versioning note: the early items below merged via PRs #15/#16; everything else ships in PR #17 (`fix/hardening-closeout`, which superseded the `fix/known-issues-hardening` branch). Because this work is landing before the v0.4.0 milestone finishes, it ships inside the `v0.4.0` release; "v0.4.1" is this section's planning label, not a promise of a separate tag.*

- [x] **Known-issues closeout (PR #17, 2026-07-18):** every remaining backlog item, #13 through #35, is fixed - per-translation versification gaps and the trailing-verse check, accurate import-run provenance, the Dexie v18 `kv` table consolidation, the DataCloneError persistence bug (preferences never actually saved), seed progress and failure surfacing, search-mode explanations, partial-translation coverage labels, and the visible search entry point. Only #17 (Web Workers, waiting on its v0.9.0 trigger) and the UX-gaps list remain, headlined by the mobile shell rendering nothing below 768 px.

**Text accuracy (critical - re-import + re-seed required):**
- [x] **Fix:** Strip footnote/study-note *content* in the text importers - WEB leaked 2,514 `<f>` footnotes + 358 `<x>` cross-ref notes into verse text (Gen 1:1 included "The Hebrew word rendered "God"…"); OEB leaked 48 OSIS `<note>` bodies. Fixed via `core/xml.ts removeElements()` applied before lemma/wj/text extraction, so words-of-Jesus offsets stay aligned. Dexie v16 clears `verses` + `searchIndexes` to re-seed. Side effect verified as correct: 25 WEB + 19 OEB "verses" whose entire content was an omission footnote ("Some manuscripts add…" - Acts 8:37, Matt 17:21, etc.) no longer appear as scripture.
- [x] **Fix:** Parse bridged verses (`<v id="15-16"/>`) - importer now records them under the first verse number with a `verseEnd` field (rendered as "15–16" in the reader). In the current WEB source all 5 bridges are omission placeholders (footnote-only, correctly empty); the support matters for future translations carrying real bridged text.
- [x] **Pipeline:** Versification validation stage (`validate-texts.ts`, runs in `import:all` - canonical chapter counts, gap analysis against a source-verified omissions list, Apocrypha numbering variants; report in `_metadata/`) + golden-sample verse tests. Bridge-aware `getVerse()` fallback for cross-refs targeting the second verse of a bridge. All three translations validate clean.
- [ ] **Pipeline:** Source checksum pinning (see open-data-sources.md → Accuracy & Reproducibility Hardening). Partial: every pinnable source now carries its commit pin in the registry (2026-07-18, known-issues #23); what remains is SHA-256 checksums of downloaded files so unpinnable hosts (eBible.org, a.openbible.info) fail loudly on silent upstream changes. ~~Per-chapter canonical verse-count table to catch trailing-verse omissions~~ - done 2026-07-18 (`kjv-versification.ts` generated from the raw KJV source; trailing check in `validate-texts.ts`).

**App correctness:**
- [x] **Fix:** `seedTranslation` missing `res.ok`/content-type check - all seeders now share `fetchJsonAsset()` (validates status + JSON parse, catching SPA-fallback 200s); each `seedAll()` step isolated so one failure can't abort the rest.
- [x] **Fix:** Race conditions in both `loadChapter` implementations - generation-counter guards; stale loads can no longer mix chapters' verses/annotations/enrichment.
- [x] **Fix:** Service-worker offline fallback - `/index.html` and `prerendered` pages now cached at install (verified in production build).
- [x] **Fix:** `navigator.storage.persist()` requested at boot; Settings → Storage panel shows persistence status + usage meter with manual retry.
- [x] **Fix:** `navHistory.goBack()` entry-eviction mismatch - walks past evicted keys; `canGoBack` matches. Docs reconciled (clearing exists via `beforeunload`, not a sessionStorage flag).
- [x] **Fix:** `prevChapter`/`nextChapter` nearest-chapter navigation; `switchTranslation` falls back gracefully when the target translation lacks the current book/chapter.
- [x] **Fix:** `/search` highlight helpers now HTML-escape verse text before `{@html}`.
- [x] **Performance:** Book/chapter lists are index-only `uniqueKeys()` scans (~1 key per chapter vs ~31K hydrated records per navigation); unit-tested against fake-indexeddb.
- [x] **Refactor:** Unify pane 0 onto `PaneState` - done 2026-07-18 (PR #17): every pane runs through the class, the duplicated navigation layer is deleted, and workspace concerns attach via navigation hooks.
- [ ] **Reactive queries via Dexie `liveQuery()`:** Replace the manual chapter-annotation reload logic with `liveQuery()` observables wrapped in Svelte 5 runes. `liveQuery()` re-fires whenever the underlying tables change - **including changes from other browser tabs**, via Dexie's built-in cross-tab observability. Payoff: create a highlight in pane A and it appears in pane B instantly; two open tabs stay in sync - infrastructure we'd otherwise never build. This *deletes* reload code (and the class of staleness bugs behind the race-condition fixes above) rather than adding it.

### Milestone Gate: Single-User Pilot
*After v0.4.0 is fully complete and [known-issues.md](known-issues.md) is cleared - and before v0.5.0 work begins in earnest - the app goes to one trusted non-technical tester (a pastor/student) for an extended feedback loop. Distribution: Cloudflare Pages + Cloudflare Access with a one-email allow-list (free; no git knowledge required on the tester's side). Hard prerequisite within the backlog: ~~the first-run seed progress screen (known-issues #16)~~ (landed 2026-07-18 - boot progress steps + failure banner + fatal-error screen) and a zero-friction feedback path. Full decided plan: [pilot-testing.md](pilot-testing.md).*

### `v0.5.0`: Manuscript & History
- [ ] **Search: Morphology-aware search** (e.g. "Find all uses of ἀγάπη across inflected forms") - requires importing original-language morphologically tagged texts (OpenScriptures `morphhb`/`morphgnt`) as a new data layer, plus a morphological analysis engine for Greek/Hebrew paradigms. Significantly larger scope than Strong's number search; deferred from v0.3.0 via v0.4.0 to here. Infrastructure groundwork (`extractLemmas`, `VerseRecord.lemmas`) is in place from v0.3.0.
- [ ] **Audio pronunciation (Hebrew, Greek, and English names)** *(added 2026-07-18)*: a small speaker button on lexicon cards and entity names. First slice is free and offline-friendly: the Web Speech API (`speechSynthesis`) with the user's installed he/el/en voices, so tapping Mephibosheth or ἀγαπάω just says it. Caveats to state in the UI: browser voices give modern Hebrew and modern Greek pronunciation, not reconstructed biblical/Koine, and voice availability varies by OS. Recorded-audio datasets (e.g. Abraham Shmuelof's Hebrew Bible readings, Koine NT recordings) are a later upgrade once licensing is checked; they would also serve read-aloud in the reader. English name pronunciation guides could additionally come from a public-domain self-pronouncing Bible name list if respellings are wanted alongside audio.
- [ ] **Reader: interlinear view** *(decided 2026-07-18: this is a reader feature, not a search mode - combining the search tabs cannot produce it)*. Per verse, show the original-language text (WLC Hebrew, a tagged Greek NT) in word order, each word aligned with its Strong's number, parsing (e.g. Qal perfect 3ms), and English gloss. Needs word-aligned data, not the verse-level Strong's tag bags that power v0.4.0's concordance work: `morphhb` for the OT (already the morphology source above), plus an openly licensed word-aligned Greek NT. Ships as a reader pane toggle; tap-a-word opens the lexicon card, reusing the v0.4.0 lookup UI. The v0.4.0 verse-level tags are still the right first step: they light up concordance search immediately and the alignment layer slots in on top.
- [ ] Timeline feature displaying compositional dating and major biblical events alongside the text. *The data layer already exists in sources we fetch today: the Theographic `periods` table plus the per-verse `minYearLookup`/`maxYearLookup` fields - no new source acquisition needed. The work is an importer (periods → a new table or static JSON) plus the view.*
- [ ] **Data Platform Phase C - surface provenance and competing claims in the client:** The pipeline already writes `conflicts.json` and `SourceRef[]` provenance (Phase B, July 2026), but none of it ships to the browser. Add the `conflicts` Dexie table seeded from `conflicts.json`, and show a "2 sources disagree" indicator with per-source attribution in `EntityDetailPanel` (e.g. "According to Theographic: X. According to OpenBible: Y."). This is the payoff step for the Phase B work and a differentiating feature for the scholar audience (competing genealogies, disputed coordinates). Manuscript variant readings (this milestone) reuse the same footnote-marker UI pattern. See [data-architecture.md](data-architecture.md) §5 and §7.3.
- [ ] **Pipeline:** Precompute stable aggregates at build time instead of in the browser. `getBookCrossReferenceMatrix()` currently scans ~340K rows client-side and caches in memory, but the matrix only changes on re-seed - compute it in the pipeline and ship it as a small static JSON. Same pattern for other aggregates: verse "degree" (most-cross-referenced verses → a "top connected passages" feature for free) and entity co-occurrence. The pipeline is free compute; the browser shouldn't re-derive stable facts.
- [ ] **Footnote extraction:** Import translation footnotes (`<f>`/`<x>` in USFX, `<note>` in OSIS) into their own field or table instead of discarding them - translation footnotes (textual variants, alternate renderings, "some manuscripts add…") are useful study data. Surface them in the reader as footnote markers, same UI pattern planned for manuscript variant readings. Origin: the v0.4.1 footnote-leakage fix strips them entirely (see [known-issues.md](known-issues.md) #1 "future option").
- [ ] **Translation Library Expansion:** ~~ASV, BSB, YLT, Darby~~ - **pulled forward 2026-07-18** (pre-pilot request): all four fetch, import, validate (source-verified omission sets; YLT is byte-perfect KJV versification), and seed at boot alongside KJV/WEB/OEB, and the three Strong's-tagged ones fill `VerseRecord.lemmas`. Still here for v0.5.0: Douay-Rheims (deuterocanon, Vulgate Psalm numbering needs the versification mapping layer), Geneva, first non-English texts (RVA, Luther 1912, Segond 1910), **on-demand per-translation seeding** (seven translations at boot is ~95MB of data; stop seeding everything up front), and the Translation Manager panel in Settings (download / remove / storage size). See [open-data-sources.md](open-data-sources.md#translation-library-expansion-planned--v050).
- [ ] **Manuscript Explorer:** More than a comparison view - a browsable catalog of manuscript witnesses with **dates, provenance, contents, and family** (e.g. 𝔓52 ~125 AD, John fragment; Sinaiticus ~350 AD, full Bible). Per-book "witness list" panel: which manuscripts attest this book, from when, and where they live today. Backbone dataset: CNTR transcriptions + metadata (CC BY 4.0). Comparison view (TR vs. MT vs. NU readings) builds on top using public-domain texts (WLC, Swete LXX, Nestle 1904). Variant readings surface as footnote-style markers in the reader - same UI pattern as competing claims.
- [ ] **Church Fathers Library:** ANF/NPNF corpus from CCEL (public domain) with **author, date range, and region on every work** - every quote in the app is dated ("Ignatius, †c. 108" beside the text, not just a name). Two integration layers: (1) readable works in a library route; (2) the printed volumes' *scripture indexes* parsed into `father-quote → verse` graph edges, so the reader can show "5 fathers cite this verse (2nd–4th c.)" - powering the v1.1.0 "Reading with the Fathers" mode and the v0.7.0 Doctrine/Succession trackers from one dataset.
- [ ] **Data Import:** Import Theographic Books dataset for rich BookMeta.
- [ ] **Data Import:** Import BibleData Thing dataset (notable biblical objects).
- [ ] **Book Metadata:** Display canon status (Protestant, Catholic, Orthodox), manuscript traditions (MT, LXX, DSS), summaries, and historical context per book.
- [ ] Extend `BookMeta` type in `packages/core` with `canons`, `manuscripts`, `summary`, `historicalContext` fields.
- [ ] **Search:** Search within user annotations (find notes/highlights by keyword).
- [ ] Commentary pane with Matthew Henry (public domain) as first dataset.
- [ ] **Object/Artifact Explorer:** Dedicated dictionary for notable biblical objects (e.g., Ark of the Covenant, Temple).
- [ ] **Story Mode:** A guided narrative exploration mode - not a reading plan, but an interactive journey through major biblical storylines. Users select a narrative (e.g. Abraham's journey, Joseph's life, the Exodus, David's rise, Jesus' final week, Paul's missionary journeys) and step through a curated sequence of passages, events, people, and places. Each step shows the relevant scripture in the reader, surfaces connected entities in the "Who's Here?" panel, and positions the user on the timeline. "Next event" / "Previous event" buttons keep the user inside one narrative thread without losing context.
  - **Why it matters:** Most Bible apps offer only two modes: read chapter-by-chapter or follow a daily reading plan. Neither helps a user trace a narrative arc across books and chapters. Story Mode turns the entity and event data already in the app into something that feels like a guided tour - engaging for everyday users, not just scholars.
  - **Data model:** A new `narratives` Dexie table in core: `'id, slug, title, *steps'`. Each step is `{ order, passageStart, passageEnd, eventId?, personIds[], placeIds[], caption }`. Seed narratives are bundled as static JSON from the data pipeline (derived from Theographic event chains and verse linkages). Users can also create custom narratives by assembling steps from existing entity data.
  - **Core vs. plugin:** The `narratives` table and the step data model are core - other features (search, cross-references, timeline) can reference narrative membership. The guided reading UI (`StoryModePlayer.svelte`) is a first-party plugin that renders inside the `ReaderWorkspace` as an alternative to free navigation, following the same plugin conventions as the genealogy viewer.
  - **Integration:** Story Mode reuses `ReaderPane` for scripture display, `EntityDetailPanel` for entity context, and the navigation history stack for backtracking within a narrative. If maps are available (v0.4.0+), each step can highlight the relevant location. If the timeline is active, the current step's date range is highlighted.

### `v0.6.0`: Extensibility (Plugin System)
- [ ] Definition of the Plugin Metadata Schema - flesh out or remove `packages/plugin-api` stub (currently empty).
- [ ] **Data Bundles:** Define the `.csdata` package format schema for distributing raw dataset plugins (commentaries, lexicons).
- [ ] Implementation of the UI Sandbox and Web Workers for plugins.
- [ ] Development of the first 3 "First-Party" plugins using the public API.
- [ ] **GitHub-style Contribution Graph:** Visual plugin rendering reading logs into an honest, non-gamified presence heatmap.

### `v0.7.0`: Scholar Features
- [ ] **Reading Logs Engine:** Core tracking of reading velocity (honest time spent per chapter) to fuel spaced repetition metrics and the contribution graph.
- [ ] **Doctrine Development Tracker:** A user-editable living timeline where scholars can construct doctrinal history (record councils, log patristic quotes, and draw connecting edges directly to specific verses). Answers: *"How did Christians come to believe this over time?"*
  - **Biblical Trail mode:** From any doctrine in the tracker, a "Read the biblical trail" button opens a guided reading path through the key passages in canonical order - showing how the concept builds from Genesis to Revelation. Generated from the same cross-reference graph and topical verse linkages that power the tracker itself, not a static curated list. Answers a different question: *"Where does the Bible actually teach this?"* This is a view mode within the Doctrine Development Tracker, not a separate feature - the data layer is identical.
- [ ] **Apostolic Succession Tracker:** A dated, sourced, graph-based view of episcopal succession - answering *"who laid hands on whom, when, and how do we know?"* No existing app (including Logos) offers this.
  - **Data model:** Reuses the genealogy engine pattern - a `successions` table of typed person→person edges (`ordained`, `consecrated`, `succeeded-as-bishop-of`) with a **see/seat** dimension (Rome, Antioch, Alexandria, Jerusalem, …), date ranges, and a mandatory **source citation per edge** (e.g. "Eusebius, *Hist. Eccl.* III.4"). Renders with the same subgraph/tree infrastructure as the genealogy viewer - lineage rail included.
  - **Seed data:** Curated from public-domain primary sources - Eusebius's *Ecclesiastical History* (NPNF II.1) bishop lists first; Irenaeus (*Against Heresies* III.3) as a second witness.
  - **Competing claims are first-class:** succession lists genuinely conflict (rival claimants, disputed dates, divergent traditions). This plugs directly into the existing `ConflictRecord` model from the data platform - both claims stored, sources attributed, no editorial verdict. That neutrality is what makes the feature usable across Catholic, Orthodox, and Protestant users.
  - **Integration:** Succession chains anchor to the Doctrine Development Tracker timeline (a council's participants link into the succession graph) and to the Church Fathers Library (each figure links to their works, with dates). User-editable like the doctrine tracker: scholars can extend chains, add sources, and export.

### `v0.8.0`: Migrate & Sync (Import/Export)
- [ ] **Sync metadata via Dexie DBCore middleware:** The E2EE sync below needs per-record last-write-wins with deletion tombstones. Dexie middleware (`db.use()`) can stamp `modifiedAt` on every write and convert deletes to tombstones *transparently*, across all user-data tables, without touching call sites - one middleware file. **Worth landing well before the rest of this milestone:** retrofitting timestamps later means auditing every `put()` in the app.
- [ ] **Evaluate the `dexie-export-import` addon (free, MIT, same author as Dexie):** Exports/imports the entire database as a structured blob with progress callbacks and per-table filtering. Filtered to the user-data tables it covers most of the JSON export/import item below; including the verse tables it covers most of the v2.0.0 Offline Bundle Generator ("KJV + my annotations + Strong's as one payload"). Prototype this before hand-rolling an export schema.
- [ ] **Bidirectional JSON Export/Import:** The core JSON export schema for annotations acts exactly as the import schema. Enables power users to export their notes, edit them in VS Code or Obsidian, and instantly re-import them. This schema is also the payload format for sync (below) and the v2.0.0 Offline Bundle Generator.
- [ ] **Client-side E2EE sync (no accounts):** Multi-device sync and backup via storage the *user* owns - Google Drive `appDataFolder` first (browser-side OAuth PKCE; no server of ours), Dropbox later. Payload is always end-to-end encrypted with a passphrase-derived key (WebCrypto AES-GCM); per-record last-write-wins merge with deletion tombstones. Syncs annotations, tags, saved searches, scratch pad, preferences - never the re-seedable datasets. Full design, and the managed-provider (Supabase) decision for later community features, in [sync-and-accounts.md](sync-and-accounts.md).
- [ ] Universal annotation export mapping for alternative formats (Markdown, plain text).
- [ ] Logos PBB/LBX importer (Parse Logos personal book annotations).
- [ ] Accordance import (HiLites and notes import).
- [ ] e-Sword import (.bblx and .topx format support).

### `v0.9.0`: Polish
- [ ] Mobile-first responsive UI optimization across all views (touch targets, flexible layouts).
- [ ] Performance audit (< 2s first load).
- [ ] Accessibility audit (WCAG 2.1 AA compliance).
- [ ] Onboarding flow (First-run wizard) - including **seed progress and error surfacing** (currently the 1–2 min first seed is silent and failures go only to the console).
- [ ] **Touch parity for hover affordances:** long-press equivalents for verse preview cards and graph node previews; swipe left/right for prev/next chapter on mobile (chapter pills are hidden there with no replacement).
- [ ] **Keyboard shortcut reference:** `?` overlay listing Cmd+K, Cmd+\, Alt+←, etc.
- [ ] **Skeleton loading states** for reader, entity panels, and graph (no more blank panels).
- [ ] **Storage panel in Settings:** persistence status (`navigator.storage.persist()`) and usage meter, per-translation sizes (pairs with the v0.5.0 Translation Manager).
- [ ] **Service Worker:** Explicitly cache Google Fonts and other external assets so the app is fully functional without any network access after first load.
- [ ] **Web Worker:** Offload MiniSearch index building to a Web Worker to prevent UI jank during initial translation load (currently blocks main thread on ~31K verse index builds). *Dexie works fully inside workers against the same database - the worker reads verses from Dexie directly, builds the index, and writes it back to `searchIndexes`, so no data crosses the worker boundary. The same pattern covers `wordSearch` full scans and any remaining client-side aggregate scans (see the v0.5.0 build-time precompute item). This makes the worker move cheaper than a message-passing design would suggest.*

### `v1.0.0`: Launch
- [ ] Finalization of the Plugin API (Stable).
- [ ] Tauri/Electron desktop wrapper generation.
- [ ] Official website documentation and plugin registry launch.
- [ ] **Search:** Boolean operators (`"faith" AND "works" NOT "law"`) and proximity search.

## Post-1.0 Roadmap

> These features extend Codex Scriptura from a scholar's tool into a full ministry platform.

### `v1.1.0`: Commentary Framework
- [ ] Commentary pane synced to active verse/chapter.
- [ ] Commentary data plugin type (standardized schema for verse-keyed content).
- [ ] **"Reading with the Fathers" Mode:** First-party plugin injecting Church Father quotes directly inline with the text as marginal references, driven by the v0.5.0 patristics dataset.
- [ ] Public domain commentary importers: Matthew Henry, Calvin, Chrysostom, JFB, Gill, Keil & Delitzsch, Bengel.
- [ ] Commentary search (search across all installed commentaries).
- [ ] Citation integration (one-click cite commentary → Turabian/Chicago/SBL).

### `v1.2.0`: Sermon & Teaching Prep
- [ ] Sermon notebook: document-style editor with drag-in verse/commentary/note blocks.
- [ ] Structured outline builder with verse-linked points and subpoints.
- [ ] Illustration and quote bank (tag, search by topic and scripture).
- [ ] Sermon archive: past sermons linked to source passages, full-text searchable.
- [ ] Export: Markdown, plain text, PPTX outline for ProPresenter/EasyWorship.

### `v1.3.0`: Devotional & Journaling
- [ ] Reading plans: create, follow, share, fork plans with daily progress tracking.
- [ ] Prayer journal: date-stamped entries linked to verses, private by default.
- [ ] Prompted reflection: configurable study questions per reading.
- [ ] Verse memorization trainer: spaced repetition drills with progress stats.
- [ ] Daily verse widget for PWA home screen.

### `v1.4.0`: Community & Sharing
> Community features are the first (and only) point where a backend and optional accounts appear.
> Provider: managed service (Supabase recommended); auth via passkeys/OAuth only; accounts strictly
> optional - the entire local experience including E2EE sync keeps working without one.
> See [sync-and-accounts.md](sync-and-accounts.md) for the full decision record.

- [ ] Shared study guides: leader creates multi-week study, group follows with shared annotations.
- [ ] Public annotation layers: scholars publish annotation sets others can subscribe to.
- [ ] Plugin marketplace backend: submission pipeline, ratings, curation.
- [ ] Forkable reading plans: browse community plans, fork and customize.

### `v2.0.0`: Multi-Modal Platform
- [ ] **Data Pipeline (Bible Apologist):** CI/CD GitHub Action to pull structured commentary from Hygraph GraphQL directly into a dedicated first-party plugin.
- [ ] **Offline Bundle Generator:** Generate a single, pre-cached export payload (e.g. "KJV, WEB, my annotations, and Strong's") for missionaries heading off-grid so the service worker has everything ready upon arrival.
- [ ] AI study assistant plugin (BYO API key): contextual Q&A, sermon brainstorming, cross-tradition comparison.
- [ ] Audio Bible sync: verse-level highlighting during playback, speed controls, bookmarks.
- [ ] Biblical geography: interactive maps synced to current reading, archaeological sites, historical layers.
- [ ] Commandment Index Plugin: Browse and filter categorized commandments from Scripture.
- [ ] Liturgical calendar plugin: daily/weekly lectionary readings (Catholic, Orthodox, Anglican, Lutheran).
- [ ] Multi-language UI: interface localization (20+ languages).
- [ ] Tablet annotation mode: stylus/handwriting input for margin notes.

---

## Feature Parking Lot

> Ideas that are valuable but don't have a clear milestone yet. Revisit quarterly.

- **Accordance/Logos cloud sync** - bidirectional sync with other platforms (requires their cooperation or reverse engineering).
- **Academic peer review** - community commentary submissions with editorial review workflow.
- **Textual criticism workspace** - full apparatus editor for scholars contributing to critical text projects.
- **Original language spaced repetition** - vocabulary and paradigm drills for Greek/Hebrew learners.
- **Print layout engine** - generate print-ready PDFs of study notes, annotated passages, or sermon manuscripts.
- **Accessibility: audio description** - AI-generated or community-contributed audio descriptions of visual features (maps, graphs, timelines) for blind users.
- **RSS/newsletter integration** - subscribe to scholar blogs and have new posts linked to relevant passages automatically.
- **Zotero/Mendeley sync** - bibliographic tool integration for academic users writing papers.
