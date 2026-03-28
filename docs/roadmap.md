# Project Roadmap

Codex Scriptura is being built iteratively in a vertical slice approach. Instead of building the entire backend before touching the UI, we build self-contained, usable milestones.

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
- [x] **Navigation Infrastructure:** `scrollToVerse(osisId)` utility and `verse-flash` CSS keyframe implemented in `src/lib/utils/navigation.ts`. Jump-to-verse actions from the Cmd+K palette and `/search` results scroll the target verse into view and apply a 1.4s accent-color flash for instant visual orientation. No database state involved — transient CSS animation only.
- [x] **Feature:** Clickable annotation routing — wire "All Annotations" sidebar entries to `goto()` + `scrollToVerse()`, reusing the existing flash infrastructure.
- [x] **Feature:** Highlight and annotation deletion (undo accidental highlights directly from the verse popup and the sidebar).
- [x] **UI Pattern:** Split annotation sidebar into "Current Chapter" vs "All Annotations" tabs.

### `v0.3.0`: Personalize & Enrich
*Status: Complete. Morphology/Strong's search items moved to v0.4.0 — see note below.*

**Done:**
- [x] **User Preferences:** Theme switching (light/dark/system), custom accent colors, and highlight preset management — fully wired to Dexie `Settings` table via `preferences.svelte.ts`.
- [x] **Typography & Layout:** Font selection (reader/UI fonts), font-size slider, layout density (compact/normal/relaxed), column width, line height — all proxied into root CSS custom properties via `$effect`.
- [x] **Settings Route (`/settings`):** Dedicated preferences UI with appearance, typography, reader, and highlight preset panels.
- [x] **Data Pipeline:** CSV→Dexie ingestion pipeline for `persons`, `places`, `events`, and `dictionary` tables (`import-theographic.ts`, `fetch-theographic.ts`, `copy-to-static.ts`). Full `setup:theographic` npm script.
- [x] **"Who's Here?" Panel:** Entity panel in the reader showing persons, places, and events mentioned in the current chapter. Entities highlighted inline in verse text via colored underlines.
- [x] **Person / Place / Event Explorer:** `EntityDetailPanel.svelte` shows bio, verse refs (current chapter + elsewhere count), geocoding confidence for places, and formatted dates for events.
- [x] **Easton's Bible Dictionary:** Inline definitions surfaced from the `dictionary` Dexie table within entity detail panels.
- [x] **Concordance (Word Study) Search:** Exhaustive exact-word scan with inflection variant matching (loved/loves/loveth). Canonical result ordering with hit counts and surface forms.
- [x] **Name Meanings:** Hebrew/Greek etymology inline via BibleData PersonLabel dataset.
- [x] **Data Pipeline:** `enrich-places-openbible.ts` — join OpenBible GPS coordinates into `places.json` seed for higher-confidence geocoding.
- [x] **Groundwork (Split view prerequisite):** Refactored the monolithic chapter view out of `read/+page.svelte` into prop-driven `ReaderPane.svelte` (scripture rendering, verse selection, entity panels, selection toolbar) and `ReaderWorkspace.svelte` (header navigation, data loading, annotation sidebar orchestration). Route is now a thin wrapper. Architecture supports future multi-pane rendering.

**Deferred to v0.4.0 (data dependency):**
- Strong's number search and morphology-aware search were originally scoped here but have been blocked since the start of v0.3.0. All code infrastructure is in place (`extractLemmas()` in both importers, `VerseRecord.lemmas` field, `ConcordanceSearchMode: 'lexical'` type, MiniSearch lemma indexing). The blocker is purely data: current KJV/OEB/WEB source texts contain no `<w lemma="...">` markup. These features are now consolidated under v0.4.0 where the BibleData Strong's CSV imports are already planned.

### `v0.3.1`: Navigation & Polish (Patch)
*Carry-forward fixes and audit-identified gaps.*
- [x]  the flash animation infrastructure on verses when you jump to them.
- [x] **UX Audit:** Verify `verse-flash` fires consistently from all jump-to-verse entry points: Cmd+K palette results, `/search` result clicks, and annotation sidebar navigation.
- [x] **Fix:** Command palette searches hardcoded KJV only; should index the user's active translation instead.
- [ ] **Performance:** MiniSearch index rebuilt from IndexedDB every browser session. Cache serialized index in IndexedDB between sessions to eliminate cold-start latency on repeat visits.
- [ ] **Navigation History Trail:** In-session reading history stored as a stack of `{ book, chapter, verseId, scrollTop }` tuples, persisted to Dexie `Settings` under key `'navHistory'`. Displayed as a compact breadcrumb strip at the bottom of the reader (e.g. Gen 1 → John 1 → Rom 8). Alt+← ("Return") shortcut pops the stack and restores the previous position including scroll offset. This is an in-app layer on top of (not replacing) browser history — it tracks verse-level context and scroll position that the browser back button discards. Clears on tab close; depth cap of ~50 entries.
- [ ] **Paragraph mode toggle:** Reader preference that renders verse text as flowing prose paragraphs using the paragraph break markers already present in the WEB translation, rather than one-verse-per-line layout. Makes narrative books (Luke, Genesis, Acts) dramatically more readable. Toggled in the reader toolbar; persisted in `UserPreferences`. Verse number superscripts remain inline.
- [ ] **Red letter mode:** Reader preference rendering words of Jesus in the user's accent color (or a dedicated red). Requires a `wj` (words of Jesus) markup flag in the source OSIS/USFX — note which installed translations carry this markup and disable the toggle gracefully for those that don't. Toggled in Settings → Reader.
- [ ] **Reading time estimate:** Display "~N min read" in the chapter navigation bar, calculated from verse count × average reading velocity (~200 wpm, adjustable in settings). Static per chapter; no reading log or tracking required.
- [ ] **Dictionary lookup on double-click:** Double-clicking (or double-tapping on mobile) any word in verse text opens the entity detail panel with the best available match. Lookup cascade: (1) Theographic entity (person, place, event) → rich entity card; (2) Easton's Bible Dictionary (`db.dictionary` — already populated in v0.3.0) → definition card; (3) fallback → minimal card with the word + "Search in Bible" link. Word normalization strips common suffixes (`-ed`, `-ing`, `-s`, `-tion`, `-ness`) to match inflected forms (e.g. double-clicking "believed" also checks "believe"). No new data source required — widens the trigger from "click a highlighted entity" to "double-click any word."

### `v0.4.0`: Deep Study (Connect & Graph)
- [ ] Cross-reference schema and importer.
- [ ] **Graph View (Zoomable Scripture Graph):** Interactive visualization of scriptural links with **progressive disclosure** — the graph must never dump all verse-level connections at once. Instead, it reveals complexity in layers as the user drills down:
  - **Zoomed out (book/section level):** Clustered nodes representing books or major sections, with weighted edges showing density of cross-references between them. Entry point for orientation — "where does Romans connect to?"
  - **Mid zoom (chapter/passage level):** Expand a cluster to see chapter-level or passage-group nodes. Major cross-reference relationships become visible. Clicking a cluster opens it; double-clicking collapses it back.
  - **Zoomed in (verse level):** Individual verses as nodes with direct connection edges. This level only renders for the currently focused cluster — never globally. Clicking any verse node opens/navigates to that passage in the reader.
  - **Hover preview:** Hovering a node at any zoom level shows a floating card with the passage text (reuses the verse hover preview infrastructure).
  - **Filtering:** Users filter by edge type (quotation, allusion, thematic echo, shared keyword) and by entity linkage (person, place, event). Filters reduce visual noise before it appears, not after.
  - **Hard constraint:** The graph renderer must enforce a visible node cap (~120 nodes) with a "too many connections — zoom in or filter" message rather than rendering an unreadable hairball. This is a UX principle, not just a performance optimization.
  - **Implementation:** 1-hop default, depth slider, expand-on-click, typed edges. The graph data model and query engine are core; the rendering layer is a first-party plugin following the same conventions as the genealogy viewer.
- [ ] **Verse hover preview:** Wikipedia-style inline preview for any verse reference — in cross-reference markers, entity detail panels, or user notes. Hovering a reference for ~400 ms shows a floating card with the verse text; no navigation required. Clicking the card navigates to the verse (pushing to the navigation history stack); Cmd+click opens it in a new split-view pane.
- [ ] **Data Pipeline:** `import-theographic-relationships.ts` to populate the `relationships` Dexie table for genealogy tracking.
- [ ] **Data Import:** Import BibleData HebrewStrongs and GreekStrongs complete datasets (`import-bibledata-hebrew-strongs.ts`, `import-bibledata-greek-strongs.ts` → `lexicon-hebrew.json`, `lexicon-greek.json`).
- [ ] **Search: Strong's Number Search** (e.g. H430 → Elohim) — activate `ConcordanceSearchMode: 'lexical'`. Requires either (a) acquiring a Strong's-tagged OSIS KJV source to populate `VerseRecord.lemmas` via the existing `extractLemmas()` pipeline, or (b) building a verse→Strong's mapping from the BibleData CSVs. All type scaffolding and MiniSearch indexing config already exist — this is a data-acquisition + importer task, not a new feature build.
- [ ] **Graph Enrichment:** Add person→verse, place→verse, and event→verse edges to the knowledge graph.
- [ ] **"Why is this quoted?":** When reading NT passages that quote the OT, display a small inline badge at the quoting verse. Clicking the badge shows the original OT source passage in a hover card (or in a new split-view pane for deeper reading). Makes OT quotations — Jesus citing Deuteronomy in Matthew 4, Paul citing Isaiah in Romans — immediately visible without requiring prior knowledge that the connection exists. Requires the cross-reference schema (already v0.4.0) with a `quotation` edge type distinct from `allusion` or `theme`.
- [ ] **Theme threading:** User-defined topical tagging — tag any verse with a theme label (e.g. "covenant", "resurrection", "faith") and view a thread of all verses tagged with that theme across the whole Bible, in canonical order with chapter context. Stored as a new annotation subtype (`type: 'theme'`) in the existing `Annotations` Dexie table — no schema change required. Thread view is a filtered display mode accessible from `/search` or a dedicated `/study/theme/:slug` route.
- [ ] **Scratch pad:** A floating persistent notepad at the workspace level, outside the verse/chapter system. Opened and dismissed with Cmd+Shift+P; slides in as a narrow panel that persists across chapter and book navigation. Persisted in Dexie `Settings` under a singleton key (same pattern as `UserPreferences`). While reading, any verse can be dragged — or sent via a "Send to scratch pad" button on the verse toolbar — and it drops in as a quoted block with the reference attached. A "Convert to note" button promotes a scratch pad selection into a proper anchored `Annotation`. The pad resets only when the user clears it manually, never on navigation.
- [ ] **Split view:** Tile 1–3 reader panes side by side in a horizontal flex row, each independently navigable with its own book, chapter, translation, and scroll position. Pane layout persisted to Dexie `Settings` under key `'splitPanes'` so it survives page refresh. *Shares this milestone with the Genealogy Viewer — the killer use case is Matthew 1 and Luke 3 open side by side.*
  - **Pane model:** Each pane is a `ReaderPane.svelte` instance holding `PaneState { id, book, chapter, translationId, scrollTop }`. Workspace holds 1–3 panes. Minimum pane width: 280 px (disables "+ Add pane" when reached). Draggable divider between panes uses flex-basis percentages (not pixels) so proportions survive window resize.
  - **Workspace toolbar** (visible only when 2+ panes are open): sync-scroll toggle (green dot when active) and "+ Add pane" button. In single-pane mode the toolbar is hidden entirely.
  - **Sync scroll:** When enabled, scrolling any pane updates `scrollTop` on all other panes proportionally as a 0–1 fraction of total scrollable height — raw-pixel sync is intentionally avoided because panes can have different content lengths.
  - **Per-pane top bar:** Book selector (dropdown pill), compact chapter number strip, translation picker (short label e.g. "KJV"), and close button (×). The first pane's close button is hidden when it is the only pane.
  - **Entry points:** (1) "Split" icon button in the main chapter nav bar (top right, next to translation picker); (2) right-click on a cross-reference hover tooltip → "Open in new pane"; (3) Cmd+\ keyboard shortcut.
  - **Parallel translation view** (same chapter, two panes, sync scroll on) is a sub-mode of split view, not a separate feature. The existing `parallelTranslation` field in `UserPreferences` will drive this preset.
- [ ] **Strong's Concordance integration** in the baseline WEB/KJV — depends on Strong's data import above.
- [ ] **Lexicon lookups:** Map Strong's numbers to Greek/Hebrew lemmas, transliterations, and glosses via a new `lexicon` Dexie table. Depends on BibleData Strong's CSV import.
- [ ] **Search:** Reference search (Type "John 3:16" to jump directly).
- [ ] **Search:** Semantic/topical search ("verses about forgiveness" via graph traversal metadata).
- [ ] **Interactive Genealogy Viewer:** Visualize person relationships from the `relationships` Dexie table using `buildPersonSubgraph(personId, depth)` in `src/lib/engines/genealogy.ts`.
  - **Entry Points:** (1) Standalone deep-exploration route `/study/person/:id` with full controls, depth slider, and layout toggle — bookmarkable. (2) Contextual mini-graph launched directly from "Who's Here?" or `EntityDetailPanel` in the reader without leaving the reading context.
  - **Tree Mode** (`d3.tree()`, top-down): For explicit lineage passages (Matthew 1, Luke 3, Genesis 5) or when the user selects "Lineage View." Optimized for reading a single ancestry chain top-to-bottom.
  - **Force/Graph Mode** (D3 force simulation): Default for open exploration. Nodes are draggable; expand-on-click adds one hop at a time. Default depth: 2; depth slider hard-capped at 4 hops to prevent unreadable hairball graphs. Node-count warning displayed above a configurable threshold.
  - **Typed Edge Visual Encoding:** `father-of`/`mother-of` solid lines; `spouse-of` dashed pink; `sibling-of` dotted; `half-sibling-same-father` long-dash low opacity; `ancestor-of` faint long-dash. Node fill: patriarch (blue), matriarch (green), descendant (purple). Unresolved person IDs render grey with a `?` label.
  - **Plugin Compatibility:** The genealogy engine (`buildPersonSubgraph`) and `relationships` table are core. The visualization layer ships as a built-in first-party feature but follows plugin API conventions so an alternative renderer can replace it without modifying core.
- [ ] **Maps:** Basic place map using place `lat`/`lng` data already in Dexie — render leaflet/maplibre tile map in `EntityDetailPanel` for places with geocoding confidence ≥ medium.

### `v0.5.0`: Manuscript & History
- [ ] **Search: Morphology-aware search** (e.g. "Find all uses of ἀγάπη across inflected forms") — requires importing original-language morphologically tagged texts (OpenScriptures `morphhb`/`morphgnt`) as a new data layer, plus a morphological analysis engine for Greek/Hebrew paradigms. Significantly larger scope than Strong's number search; deferred from v0.3.0 via v0.4.0 to here. Infrastructure groundwork (`extractLemmas`, `VerseRecord.lemmas`) is in place from v0.3.0.
- [ ] Timeline feature displaying compositional dating and major biblical events alongside the text.
- [ ] Manuscript comparison view (e.g. TR vs. MT vs. NU).
- [ ] Church Fathers library integration (static domain texts).
- [ ] **Data Import:** Import Theographic Books dataset for rich BookMeta.
- [ ] **Data Import:** Import BibleData Thing dataset (notable biblical objects).
- [ ] **Book Metadata:** Display canon status (Protestant, Catholic, Orthodox), manuscript traditions (MT, LXX, DSS), summaries, and historical context per book.
- [ ] Extend `BookMeta` type in `packages/core` with `canons`, `manuscripts`, `summary`, `historicalContext` fields.
- [ ] **Search:** Search within user annotations (find notes/highlights by keyword).
- [ ] Commentary pane with Matthew Henry (public domain) as first dataset.
- [ ] **Object/Artifact Explorer:** Dedicated dictionary for notable biblical objects (e.g., Ark of the Covenant, Temple).
- [ ] **Story Mode:** A guided narrative exploration mode — not a reading plan, but an interactive journey through major biblical storylines. Users select a narrative (e.g. Abraham's journey, Joseph's life, the Exodus, David's rise, Jesus' final week, Paul's missionary journeys) and step through a curated sequence of passages, events, people, and places. Each step shows the relevant scripture in the reader, surfaces connected entities in the "Who's Here?" panel, and positions the user on the timeline. "Next event" / "Previous event" buttons keep the user inside one narrative thread without losing context.
  - **Why it matters:** Most Bible apps offer only two modes: read chapter-by-chapter or follow a daily reading plan. Neither helps a user trace a narrative arc across books and chapters. Story Mode turns the entity and event data already in the app into something that feels like a guided tour — engaging for everyday users, not just scholars.
  - **Data model:** A new `narratives` Dexie table in core: `'id, slug, title, *steps'`. Each step is `{ order, passageStart, passageEnd, eventId?, personIds[], placeIds[], caption }`. Seed narratives are bundled as static JSON from the data pipeline (derived from Theographic event chains and verse linkages). Users can also create custom narratives by assembling steps from existing entity data.
  - **Core vs. plugin:** The `narratives` table and the step data model are core — other features (search, cross-references, timeline) can reference narrative membership. The guided reading UI (`StoryModePlayer.svelte`) is a first-party plugin that renders inside the `ReaderWorkspace` as an alternative to free navigation, following the same plugin conventions as the genealogy viewer.
  - **Integration:** Story Mode reuses `ReaderPane` for scripture display, `EntityDetailPanel` for entity context, and the navigation history stack for backtracking within a narrative. If maps are available (v0.4.0+), each step can highlight the relevant location. If the timeline is active, the current step's date range is highlighted.

### `v0.6.0`: Extensibility (Plugin System)
- [ ] Definition of the Plugin Metadata Schema — flesh out or remove `packages/plugin-api` stub (currently empty).
- [ ] **Data Bundles:** Define the `.csdata` package format schema for distributing raw dataset plugins (commentaries, lexicons).
- [ ] Implementation of the UI Sandbox and Web Workers for plugins.
- [ ] Development of the first 3 "First-Party" plugins using the public API.
- [ ] **GitHub-style Contribution Graph:** Visual plugin rendering reading logs into an honest, non-gamified presence heatmap.

### `v0.7.0`: Scholar Features
- [ ] **Reading Logs Engine:** Core tracking of reading velocity (honest time spent per chapter) to fuel spaced repetition metrics and the contribution graph.
- [ ] **Doctrine Development Tracker:** A user-editable living timeline where scholars can construct doctrinal history (record councils, log patristic quotes, and draw connecting edges directly to specific verses). Answers: *"How did Christians come to believe this over time?"*
  - **Biblical Trail mode:** From any doctrine in the tracker, a "Read the biblical trail" button opens a guided reading path through the key passages in canonical order — showing how the concept builds from Genesis to Revelation. Generated from the same cross-reference graph and topical verse linkages that power the tracker itself, not a static curated list. Answers a different question: *"Where does the Bible actually teach this?"* This is a view mode within the Doctrine Development Tracker, not a separate feature — the data layer is identical.

### `v0.8.0`: Migrate (Import/Export)
- [ ] **Bidirectional JSON Export/Import:** The core JSON export schema for annotations acts exactly as the import schema. Enables power users to export their notes, edit them in VS Code or Obsidian, and instantly re-import them.
- [ ] Universal annotation export mapping for alternative formats (Markdown, plain text).
- [ ] Logos PBB/LBX importer (Parse Logos personal book annotations).
- [ ] Accordance import (HiLites and notes import).
- [ ] e-Sword import (.bblx and .topx format support).

### `v0.9.0`: Polish
- [ ] Mobile-first responsive UI optimization across all views (touch targets, flexible layouts).
- [ ] Performance audit (< 2s first load).
- [ ] Accessibility audit (WCAG 2.1 AA compliance).
- [ ] Onboarding flow (First-run wizard).
- [ ] **Service Worker:** Explicitly cache Google Fonts and other external assets so the app is fully functional without any network access after first load.
- [ ] **Web Worker:** Offload MiniSearch index building to a Web Worker to prevent UI jank during initial translation load (currently blocks main thread on ~31K verse index builds).

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

- **Accordance/Logos cloud sync** — bidirectional sync with other platforms (requires their cooperation or reverse engineering).
- **Academic peer review** — community commentary submissions with editorial review workflow.
- **Textual criticism workspace** — full apparatus editor for scholars contributing to critical text projects.
- **Original language spaced repetition** — vocabulary and paradigm drills for Greek/Hebrew learners.
- **Print layout engine** — generate print-ready PDFs of study notes, annotated passages, or sermon manuscripts.
- **Accessibility: audio description** — AI-generated or community-contributed audio descriptions of visual features (maps, graphs, timelines) for blind users.
- **RSS/newsletter integration** — subscribe to scholar blogs and have new posts linked to relevant passages automatically.
- **Zotero/Mendeley sync** — bibliographic tool integration for academic users writing papers.
