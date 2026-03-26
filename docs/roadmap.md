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

### `v0.2.0`: Annotate ✓
- [x] Highlight UI with multi-color support.
- [x] Rich text note editor attached to passage ranges.
- [x] Hierarchy tagging system for notes and bookmarks.
- [x] Annotation persistence in Dexie.js.
- [x] **Command Palette (Cmd+K):** Primary search entry; instant verse, word, book, or note jump without page transitions.
- [x] **Advanced Search Route (`/search`):** Refactored as a power-user destination for heavy filtering, saved searches, and multi-translation comparisons.

### `v0.2.1`: Annotation Navigation (Patch) ✓
- [x] **Bugfix:** Resolve sidebar state desync where `chapterAnnotations` retains stale data after chapter navigation.
- [x] **Feature:** Clickable annotation routing (clicking a global note jumps the reader directly to that verse).
- [x] **Feature:** Highlight and annotation deletion (undo accidental highlights directly from the verse popup and the sidebar).
- [x] **UI Pattern:** Split annotation sidebar into "Current Chapter" vs "All Annotations" tabs.

### `v0.3.0`: Personalize & Languages
- [ ] **User Preferences:** Theme switching, custom accent colors, and highlight preset management.
- [ ] **Typography & Layout:** Reactive font selection (English/Greek/Hebrew), font-size, layout density, and view modes mapping to CSS properties.
- [ ] **Search:** Morphology-aware search (e.g. "Find all uses of ἀγάπη").
- [ ] **Search:** Strong's number search (e.g. search H430 to find Elohim).
- [ ] **Data Import:** Import Theographic People, Places, and Events metadata into Dexie schema.
- [ ] **Data Import:** Import Theographic Easton's Dictionary dataset.
- [ ] **Person Explorer:** Click a name to see bio, family tree, and all verse references.
- [ ] **"Who's Here?" Sidebar:** Show persons, places, and events mentioned in the current chapter (Phase 1: flat contextual entities. Phase 2 later: mini-timeline of sequence/causality).
- [ ] **Easton's Bible Dictionary:** Show inline definitions for unfamiliar terms.
- [ ] **Name Meanings:** Show Hebrew/Greek etymology inline (via BibleData PersonLabel).

### `v0.4.0`: Deep Study (Connect & Graph)
- [ ] Cross-reference schema and importer.
- [ ] **Graph View:** Interactive visualization of scriptural links. Must prioritize clarity: 1-hop default, depth slider, expand-on-click, and typed edges (e.g., quotation, allusion).
- [ ] Hover-to-preview tooltips for cross-references in the reader.
- [ ] **Data Import:** Import BibleData PersonRelationship edges for genealogy tracking.
- [ ] **Data Import:** Import BibleData HebrewStrongs and GreekStrongs complete datasets.
- [ ] **Graph Enrichment:** Add person→verse, place→verse, and event→verse edges to the knowledge graph.
- [ ] Parallel viewing mode (side-by-side translations).
- [ ] Strong's Concordance integration in the baseline WEB/KJV.
- [ ] Lexicon basic lookups mapping to Greek/Hebrew lemmas.
- [ ] **Search:** Reference search (Type "John 3:16" to jump directly).
- [ ] **Search:** Semantic/topical search ("verses about forgiveness" via graph traversal metadata).
- [ ] **Interactive Genealogy Trees:** Visualize lineages (e.g., David's line, Jesus's genealogy).

### `v0.5.0`: Manuscript & History
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

### `v0.6.0`: Extensibility (Plugin System)
- [ ] Definition of the Plugin Metadata Schema.
- [ ] **Data Bundles:** Define the `.csdata` package format schema for distributing raw dataset plugins (commentaries, lexicons) to ensure a first-class artifact type.
- [ ] Implementation of the UI Sandbox and Web Workers for plugins.
- [ ] Development of the first 3 "First-Party" plugins using the public API.
- [ ] **GitHub-style Contribution Graph:** Visual plugin rendering reading logs into an honest, non-gamified presence heatmap.

### `v0.7.0`: Scholar Features
- [ ] **Reading Logs Engine:** Core tracking of reading velocity (honest time spent per chapter) to fuel spaced repetition metrics and the contribution graph.
- [ ] **Doctrine Development Tracker:** A user-editable living timeline where scholars can construct doctrinal history (record councils, log patristic quotes, and draw connecting edges directly to specific verses).

### `v0.8.0`: Migrate (Import/Export)
- [ ] **Bidirectional JSON Export/Import:** The core JSON export schema for annotations acts exactly as the import schema. This enables power users to export their notes, edit them in VS Code or Obsidian, and instantly re-import them (serving as a natural bridge to external content pipelines).
- [ ] Universal annotation export mapping for alternative formats (Markdown, plain text).
- [ ] Logos PBB/LBX importer (Parse Logos personal book annotations).
- [ ] Accordance import (HiLites and notes import).
- [ ] e-Sword import (.bblx and .topx format support).

### `v0.9.0`: Polish
- [ ] Mobile-first responsive UI optimization across all views (touch targets, flexible layouts).
- [ ] Performance audit (< 2s first load).
- [ ] Accessibility audit (WCAG 2.1 AA compliance).
- [ ] Onboarding flow (First-run wizard).

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
