# Project Roadmap

Codex Scriptura is being built iteratively in a vertical slice approach. Instead of building the entire backend before touching the UI, we build self-contained, usable milestones.

## 🚀 The Path to 1.0

### `v0.1.0`: Foundation (Current)
- [x] Monorepo structure (`core`, `db`, `data-pipeline`).
- [x] OSIS/USFX text importers (KJV, WEB, OEB).
- [x] SvelteKit PWA App Shell.
- [x] Offline-first SQLite/IndexedDB syncing.
- [x] Basic Bible reader and canonical lists.
- [x] MiniSearch exact & fuzzy full-text search.
- [ ] Service worker caching (offline capability).

### `v0.2.0`: Annotate
- [ ] Highlight UI with multi-color support.
- [ ] Rich text note editor attached to passage ranges.
- [ ] Hierarchy tagging system for notes and bookmarks.
- [ ] Annotation persistence in Dexie.js.

### `v0.3.0`: Interconnect
- [ ] Cross-reference schema and importer.
- [ ] Obsidian-style interactive graph view of scriptural links.
- [ ] Hover-to-preview tooltips for cross-references in the reader.

### `v0.4.0`: Deep Study
- [ ] Parallel viewing mode (side-by-side translations).
- [ ] Strong's Concordance integration in the baseline WEB/KJV.
- [ ] Lexicon basic lookups mapping to Greek/Hebrew lemmas.

### `v0.5.0`: Manuscript & History
- [ ] Timeline feature displaying compositional dating alongside the text.
- [ ] Manuscript comparison view (e.g. TR vs. MT vs. NU).
- [ ] Church Fathers library integration (static domain texts).

### `v0.6.0` - `v0.9.0`: Extensibility
- [ ] Definition of the Plugin Metadata Schema.
- [ ] Implementation of the UI Sandbox and Web Workers for plugins.
- [ ] Development of the first 3 "First-Party" plugins using the public API.
- [ ] Doctrine Development Tracker plugin (the killer feature).

### `v1.0.0`: Launch
- [ ] Finalization of the Plugin API (Stable).
- [ ] Tauri/Electron desktop wrapper generation.
- [ ] Official website documentation and plugin registry launch.
