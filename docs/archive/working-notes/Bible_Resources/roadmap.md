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

### `v0.2.0`: Annotate (Current)
- [x] Highlight UI with multi-color support.
- [x] Rich text note editor attached to passage ranges.
- [x] Hierarchy tagging system for notes and bookmarks.
- [x] Annotation persistence in Dexie.js.
- [ ] Annotation export (JSON, Markdown).
- [ ] Command palette (Cmd+K).
- [ ] **Search:** Multi-translation search (search across all installed Bibles).

### `v0.2.1`: Annotation Navigation (Patch)
- [ ] **Bugfix:** Resolve sidebar state desync where `chapterAnnotations` retains stale data after chapter navigation.
- [ ] **Feature:** Clickable annotation routing (clicking a global note jumps the reader directly to that verse).
- [ ] **Feature:** Highlight and annotation deletion (undo accidental highlights directly from the verse popup and the sidebar).
- [ ] **UI Pattern:** Split annotation sidebar into "Current Chapter" vs "All Annotations" tabs.

### `v0.3.0`: Personalize & Interconnect
- [ ] **User Preferences:** Theme switching, custom accent colors, and highlight preset management.
- [ ] **Typography & Layout:** Reactive font selection (English/Greek/Hebrew), font-size, layout density, and view modes mapping to CSS properties.
- [ ] Cross-reference schema and importer.
- [ ] Obsidian-style interactive graph view of scriptural links.
- [ ] Hover-to-preview tooltips for cross-references in the reader.
- [ ] **Search:** Morphology-aware search (e.g. "Find all uses of ἀγάπη").
- [ ] **Search:** Strong's number search (e.g. search H430 to find Elohim).
- [ ] **Person Explorer:** Click a name to see bio, family tree, and all verse references.
- [ ] **"Who's Here?" Sidebar:** Show persons, places, and events mentioned in the current chapter.
- [ ] **Easton's Bible Dictionary:** Show inline definitions for unfamiliar terms.
- [ ] **Name Meanings:** Show Hebrew/Greek etymology inline.
- [ ] **Graph Enrichment:** Add person→verse, place→verse, and event→verse edges to the knowledge graph.

### `v0.4.0`: Deep Study
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
- [ ] **Book Metadata:** Display canon status (Protestant, Catholic, Orthodox), manuscript traditions (MT, LXX, DSS), summaries, and historical context per book.
- [ ] Extend `BookMeta` type in `packages/core` with `canons`, `manuscripts`, `summary`, `historicalContext` fields.
- [ ] **Search:** Search within user annotations (find notes/highlights by keyword).
- [ ] Commentary pane with Matthew Henry (public domain) as first dataset.
- [ ] **Object/Artifact Explorer:** Dedicated dictionary for notable biblical objects (e.g., Ark of the Covenant, Temple).

### `v0.6.0` - `v0.9.0`: Extensibility
- [ ] Definition of the Plugin Metadata Schema.
- [ ] Implementation of the UI Sandbox and Web Workers for plugins.
- [ ] Development of the first 3 "First-Party" plugins using the public API.
- [ ] Doctrine Development Tracker plugin (the killer feature).

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
