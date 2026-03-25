# Project Roadmap

Codex Scriptura is being built iteratively in a vertical slice approach. Instead of building the entire backend before touching the UI, we build self-contained, usable milestones.

## 🚀 The Path to 1.0

### `v0.1.0`: Foundation ✅
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

### `v0.3.0`: Interconnect
- [ ] Cross-reference schema and importer.
- [ ] Obsidian-style interactive graph view of scriptural links.
- [ ] Hover-to-preview tooltips for cross-references in the reader.
- [ ] **Search:** Morphology-aware search (e.g. "Find all uses of ἀγάπη").
- [ ] **Search:** Strong's number search (e.g. search H430 to find Elohim).

### `v0.4.0`: Deep Study
- [ ] Parallel viewing mode (side-by-side translations).
- [ ] Strong's Concordance integration in the baseline WEB/KJV.
- [ ] Lexicon basic lookups mapping to Greek/Hebrew lemmas.
- [ ] **Search:** Reference search (Type "John 3:16" to jump directly).
- [ ] **Search:** Semantic/topical search ("verses about forgiveness" via graph traversal).

### `v0.5.0`: Manuscript & History
- [ ] Timeline feature displaying compositional dating alongside the text.
- [ ] Manuscript comparison view (e.g. TR vs. MT vs. NU).
- [ ] Church Fathers library integration (static domain texts).
- [ ] **Book Metadata:** Display canon status (Protestant, Catholic, Orthodox), manuscript traditions (MT, LXX, DSS), summaries, and historical context per book.
- [ ] Extend `BookMeta` type in `packages/core` with `canons`, `manuscripts`, `summary`, `historicalContext` fields.
- [ ] **Search:** Search within user annotations (find notes/highlights by keyword).

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
