# Architecture Overview

Codex Scriptura is structured as a modern, offline-first application. To ensure speed and reliability in environments with poor network connectivity, all core reads and writes happen against a local database.

## The Stack
-   **SvelteKit 5 (Runes):** The core application framework.
-   **Dexie.js:** A wrapper around IndexedDB for local, offline persistence.
-   **MiniSearch:** In-memory client-side indexing for immediate full-text search without a backend.
-   **Vanilla CSS:** Keeping styles light, clean, and custom.
-   **Data pipeline:** Node.js/tsx scripts in `packages/data-pipeline` for offline-first local CSV/XML parsing to JSON. Shared pipeline infrastructure (source registry, entity resolution, merge engine, conflict tracking) lives in `packages/data-pipeline/src/core/`. See [Data Platform Architecture](data-architecture.md) for the multi-source provenance and merge model.

## Database Schema (Dexie)
The application uses a versioned Dexie schema defined in `packages/db/src/index.ts`. Current version: **v16**.

1.  **Verses** (v1): Compound indexed by `translationId+book+chapter` for instant chapter rendering.
2.  **Translations** (v1): Metadata for available Bibles (e.g., KJV, WEB, OEB).
3.  **Annotations** (v1/v2): Highlights, notes, and bookmarks keyed to verse ranges (`verseStart`, `verseEnd`). Translation-agnostic via OSIS IDs.
4.  **Tags** (v1): Organization system for annotations with user-defined taxonomy.
5.  **Settings** (v1/v4): User preferences (theme, fonts, reader options, highlight presets).
6.  **SavedSearches** (v3): Persisted concordance/full-text queries.
7.  **Persons** (v5): `id, name, *verseRefs` - Theographic people, ~3,300 entries.
8.  **Places** (v5): `id, name, lat, lng, *verseRefs` - Theographic/OpenBible locations, ~1,600 entries.
9.  **Events** (v5): `id, name, *verseRefs` - Theographic events, ~4,000 entries.
10. **Dictionary** (v5): `id, term` - Easton's Bible Dictionary, ~3,700 entries.
11. **SearchIndexes** (v8): Cached serialized MiniSearch indexes to avoid rebuild on every session.
12. **CrossReferences** (v9): `id, sourceVerse, targetVerse, type, [sourceVerse+type], [targetVerse+type]` - ~340K verse-to-verse linkages from OpenBible/TSK.
13. **Relationships** (v10): `id, personFrom, personTo, type, [personFrom+type], [personTo+type]` - genealogy edges from Theographic family columns (primary), supplemented by BibleData `PersonRelationship.csv` for `ancestor-of` and `half-sibling-same-father` edges only.
14. **Lexicon** (v11): `id, strongsNumber, language, lemma` - Strong's lexicon. Hebrew (8,674 entries) from BibleData; Greek from the OpenScriptures Strong's dictionary.

Versions v12–v16 are data/preference migrations (no schema change): v12 clears `relationships` to re-seed with deterministically mapped Theographic IDs; v13 clears `crossReferences` to re-seed with corrected quotation classifications from the typed overlay datasets; v14 and v15 migrate users still on the old default accent color, fonts, and `system` theme to the cool-slate dark-first defaults (explicit customizations untouched); v16 clears `verses` and `searchIndexes` to re-seed with corrected text extraction (footnote/cross-ref-note content no longer leaks into verse text; bridged verses like `<v id="15-16"/>` are imported with a `verseEnd` field instead of dropped).

*Planned (v0.5.0):*
- **Narratives**: `id, slug, title, *steps` - curated narrative paths through scripture.

## Dexie Capabilities: Adopted & Planned

> **Licensing note:** Dexie.js is Apache-2.0 open source with **no usage limits** - it is a
> wrapper around the browser-native IndexedDB API. The "3 production users" limit sometimes
> mentioned online applies only to **Dexie Cloud**, a separate commercial sync service by the
> same author, which Codex Scriptura does not use - our sync design is user-owned-storage E2EE
> (see [sync-and-accounts.md](sync-and-accounts.md)).

**Adopted:**
- **Compound indexes** (`[translationId+book+chapter]`, `[sourceVerse+type]`, …) for instant chapter rendering and typed edge queries.
- **Multi-entry indexes** (`*verseRefs`) for reverse entity lookups ("which persons appear in Genesis 12?").
- **Versioned migrations** with `upgrade()` transactions - both schema changes (v1–v11) and data-only migrations (v12–v16 re-seeds and preference rewrites).
- **Index-only key scans** (`Collection.uniqueKeys()`) for book/chapter lists - ~1 key per chapter instead of hydrating ~31K records (known-issues #12 fix).

**Planned (with roadmap milestone):**
- **`liveQuery()` reactive queries** *(v0.4.1)*: observables that re-fire whenever the underlying tables change - **including from other browser tabs**, via Dexie's built-in cross-tab observability. Wrapped in Svelte 5 runes, this replaces manual chapter-annotation reload logic: a highlight created in pane A appears in pane B instantly, and multiple open tabs stay in sync for free. It deletes reload code (and its staleness-bug class) rather than adding code.
- **DBCore middleware for sync metadata** *(v0.8.0, land early)*: `db.use()` middleware stamping `modifiedAt` on every write and converting deletes into tombstones transparently across all user-data tables - one file, no call-site changes. Prerequisite for the per-record last-write-wins E2EE sync; retrofitting timestamps later would mean auditing every `put()` in the app.
- **Dexie in a Web Worker** *(v0.9.0)*: Dexie works fully inside workers against the same database, so heavy work (MiniSearch index builds, full-table scans) can read from and write back to Dexie entirely off the main thread - no data serialization across the worker boundary (known-issues #17).
- **`dexie-export-import` addon** *(v0.8.0, free/MIT)*: whole-database export/import as a structured blob with progress callbacks and per-table filtering - the likely foundation for annotation export/import and the v2.0.0 Offline Bundle Generator, to be prototyped before hand-rolling an export schema.

## Book Metadata Layer (Planned - v0.5.0)
*Status: Design phase*

Each book in the canonical `BOOKS` array will be extended with rich metadata:

| Field | Type | Examples |
|-------|------|----------|
| `canons` | `string[]` | `['protestant', 'catholic', 'orthodox']` |
| `manuscripts` | `string[]` | `['MT', 'LXX', 'DSS', 'Vulgate']` |
| `summary` | `string` | Brief scholarly overview of the book |
| `historicalContext` | `string` | Dating, authorship, provenance |

This is static reference data baked into `@codex-scriptura/core` - no new Dexie table is needed. The reader UI will surface this via a "Book Info" panel accessible from the book selector dropdown.

## Data Platform & Provenance
*Status: Pipeline adoption landed (July 2026) - entity resolver, conflict store, and import-run ledger are live in the enrichment importers; client-side conflict surfacing still pending. See [data-architecture.md](data-architecture.md) for the full spec and current phase status.*

Codex Scriptura integrates data from multiple open datasets (Theographic, OpenBible, BibleData, and others). Each dataset is authoritative for different domains, and merge precedence is domain-specific - not a single global chain. Key architectural principles:

- **Source Registry** (`packages/data-pipeline/src/core/source-registry.ts`): Every integrated dataset is registered with license, URL, domain coverage, and precedence tiers.
- **Field-level provenance**: Entity records carry `sources?: SourceRef[]` tracking which source contributed each field. Defined in `packages/core/src/types.ts`.
- **Competing claims**: When sources disagree, both values are preserved via `ConflictRecord` rather than silently merged. The higher-precedence value is the display default; alternatives are surfaceable in the UI.
- **Entity resolution**: Cross-dataset identity mapping (e.g., Theographic's "jerusalem_1" ↔ OpenBible's "Jerusalem") via a `ResolutionMap` with confidence scoring. See `packages/data-pipeline/src/core/entity-resolver.ts`.
- **Translation texts are never merged** across datasets. Each translation is self-contained.

Domain precedence summary:

| Domain | Primary | Enrichment |
|---|---|---|
| Persons / Places / Events | Theographic | BibleData, OpenBible Geo |
| Relationships / Genealogy | Theographic (family columns) | BibleData (`ancestor-of`, `half-sibling-same-father` only) |
| Cross-references | OpenBible/TSK | - |
| Lexicon (Strong's) | BibleData | - |
| Texts | Per-translation (never merged) | - |

## Search Engine Architecture
*Status: Implemented (Basic) → Planned (Advanced)*
Full-text search is entirely client-side, powered by **MiniSearch** and populated directly from IndexedDB. It uses BM25 scoring with custom stop-word filtering and exact-phrase re-ranking. 

**UX Paradigm:**
- **Primary Interface (Cmd+K):** The universal command palette. Users type a verse, word, book, or note to get an instant stream of results and quick jumps without a page transition.
- **Advanced Mode (`/search`):** A dedicated route for heavy research workflows: advanced filtering, saved searches, and multi-translation comparisons.

The search pipeline evolves as follows:
- **v0.2 / v0.3 (done):** Command palette with instant verse/book jump, exact phrase re-ranking, and stop-word filters.
- **v0.3.0 (done):** Concordance (Word Study) mode with exhaustive exact-word scan and inflection variant matching.
- **v0.4.0:** Strong's number lookup (`H430`) - blocked on acquiring Strong's-tagged source data; all code infrastructure ready. Semantic/topical search via metadata traversal.
- **v0.5.0:** Morphology-aware search (Greek/Hebrew inflections) - requires original-language tagged texts + morphological analyzer. Search indexing for user annotations and notes.
- **v1.0.0:** Advanced boolean query operators (`AND`, `OR`, `NOT`) in the `/search` panel.

## Verse Navigation & Flash
*Status: Implemented (v0.2.1–v0.3.1)*

Any jump-to-verse action draws the eye via a transient CSS animation. This is a pure reader navigation behavior - no database state is written, no annotation is created. The flash is always short-lived by design.

- **Trigger:** `goto()` (SvelteKit router) followed immediately by `tick().then(() => scrollToVerse(...))`. The `tick()` ensures the DOM is flushed post-navigation before the element is queried. Skip `goto()` if already on the correct chapter.
- **Engine:** `scrollToVerse(osisId)` (now part of `ReaderPane.svelte` after the v0.3.0 reader refactor) queries the verse `<span>` by `[data-osis]` attribute, scrolls it into view (`block: 'center'`), then removes and re-adds the `verse-flash` CSS class to restart the animation deterministically.
- **Animation:** `verse-flash` applies a 1.4s ease-out keyframe: transparent → `--color-accent-subtle` at 20% → transparent. The variable strictly follows the user's custom accent color from `UserPreferences`.
- **Entry Points:** Cmd+K palette results, `/search` result clicks (v0.2.1), and annotation sidebar cross-chapter navigation (v0.3.1) are all wired.
- **Design Principle:** This is intentionally not a database feature. Do not add persistence, "last-flashed verse" tracking, or notification state. Plugins that navigate to verses should call `scrollToVerse()` via the core navigation hook rather than implement their own scroll or flash logic.

## Navigation History
*Status: Implemented (v0.3.1)*

An in-app session history stack that tracks verse-level context independent of (and in addition to) browser history. The browser back button navigates between SvelteKit routes but discards scroll position and verse focus; the navigation history stack preserves both.

- **Data shape:** `{ book: string, chapter: number, verseId?: number, scrollTop: number }[]`. Stored in the Dexie `kv` table under key `'navHistory'` (v18 - previously a stray record in the typed `settings` table). Cleared on tab close via a best-effort `beforeunload` listener in `+layout.svelte` (may not fire on mobile or crash). Capped at 6 unique breadcrumb entries plus a 20-key temporal back stack; `goBack()` skips stack keys whose entries have been evicted.
- **Push rule:** Every `goto()` or manual chapter navigation pushes the *current* position before navigating. Cross-reference follows and annotation jumps push automatically. Programmatic scroll-only movements (e.g. `scrollToVerse`) do not push - they are sub-navigation within the same chapter.
- **Alt+← ("Return") shortcut:** Pops the stack, calls `goto()` to restore the chapter if different, then calls `scrollToVerse()` with the stored verse ID. Intercepts the native browser Alt+← before it triggers the browser back button - the in-app stack is the intended target.
- **Breadcrumb display:** A compact strip at the bottom of the reader showing the last ~5 entries. Clicking any entry navigates directly (does not pop intermediate entries - it inserts the current position as a new push so the trail remains coherent).
- **Design principle:** This is not a reading log (no timestamps, no analytics). It is purely a navigation affordance. Do not conflate it with the v0.7.0 Reading Logs engine.

## Split View / Reader Workspace
*Status: Partially implemented (v0.4.0). Pane tiling, per-pane navigation, and layout persistence work. The sync-scroll toggle, workspace toolbar, and draggable dividers described below are spec, not yet built - see [known-issues.md](known-issues.md) #13 and the re-opened roadmap item.*

Split view tiles 1–3 independent reader panes side by side. This section documents the component architecture, state model, and key implementation constraints.

### Route & Components
The `/read` route does not change. It now renders `ReaderWorkspace.svelte` instead of a chapter view directly. Two new components are introduced:

| Component | Path | Responsibility |
|---|---|---|
| `ReaderWorkspace` | `src/lib/components/ReaderWorkspace.svelte` | Owns the `panes[]` array; renders the flex row, draggable dividers, and workspace toolbar; coordinates sync scroll |
| `ReaderPane` | `src/lib/components/ReaderPane.svelte` | A fully self-contained reader instance - owns its own Dexie verse query, scroll handler, and entity highlighting |

`EntityDetailPanel` remains **workspace-level** (outside the pane row). Clicking an entity in any pane opens the same shared detail panel so the UI never has competing panels.

### Pane State
`PaneState` (`src/lib/stores/splitPanes.svelte.ts`) is a rune-based class owning one pane's complete navigation state and logic: location (`book`, `chapter`, `translation`), loaded data (`verses`, `enrichment`, annotations), UI state (selection, panel mode, book-selector), and all navigation actions (`navigateToBook/Chapter`, `prevChapter`/`nextChapter`, `switchTranslation`, `jumpTo`) with a generation counter guarding against interleaved loads. **Every pane - including the primary - is a `PaneState` instance** (since the known-issues #14 unification; previously pane 0 duplicated this logic with workspace-local `$state` and the copies had diverged). Workspace-only concerns hook in via `onBeforeNavigate`/`onAfterNavigate`: pane 0 wires nav history + preferences + URL sync, extra panes wire split-layout persistence, so any pane's navigation survives a reload.

Pane locations (`{ book, chapter, translation }` per pane, primary first) are persisted to the Dexie `kv` table under key `'splitPanes'` (v18 - previously `localStorage`, migrated lazily on first restore); pane 0's location is additionally the `lastBook`/`lastChapter`/`activeTranslation` in Dexie preferences and the `?book=&chapter=` URL params.

### Draggable Divider
The divider between panes is implemented with `pointermove` events and `flex-basis` percentages rather than pixel widths. This ensures pane proportions are preserved across window resizes. Hit area: 4 px. Minimum pane width: 280 px (enforced by disabling the "+ Add pane" button rather than clamping mid-drag).

### Sync Scroll
Sync scroll is coordinated in `ReaderWorkspace`, not in individual panes. Each `ReaderPane` emits a `scroll` event; the workspace catches it and, when sync is enabled, calls `pane.scrollTo()` on all sibling panes using a **0–1 proportional fraction** of total scrollable height. Raw-pixel sync is intentionally avoided - panes displaying different books or translations have different content heights, and pixel-syncing would misalign them immediately.

### Workspace Toolbar
The toolbar (sync-scroll toggle and "+ Add pane" button) is hidden entirely in single-pane mode. It appears only when 2+ panes are open so the default reading experience is unchanged.

### Entry Points into Split View
1. "Split" icon button in the main chapter nav bar (top right, adjacent to the translation picker) - adds a second pane.
2. Right-click on a cross-reference hover tooltip → "Open in new pane".
3. Cmd+\ keyboard shortcut (mirrors VS Code muscle memory).

### Parallel Translation View
Parallel translation (same chapter, two panes, sync scroll on) is a **sub-mode** of split view, not a separate feature. The `parallelTranslation` field already present in `UserPreferences` will activate this preset.

## Preferences & Theming System
*Status: Implemented (v0.3.0)*
A reactive, offline-first preferences engine ensuring instant UI updates and plugin extensibility.

- **Data Model:** A singleton `UserPreferences` interface tracking `theme`, `accentColor`, `fontOptions` (size, grouping by language context), `readerOptions` (layout density, parallel/interlinear toggles), and `highlightPresets`.
- **Storage Context:** Persisted locally in the Dexie `Settings` table under a permanent `'default'` ID to avoid multi-row fragmentation.
- **State Management:** Powered globally by Svelte 5 Runes. On app boot, preferences load from IndexedDB into a root `$state` object.
- **DOM Integration:** A Svelte `$effect` actively proxies rune properties into root CSS Custom Properties (e.g., `--color-accent`, `--font-scripture`, `--layout-gap`) on the `document.documentElement`, ensuring zero UI judder and absolute separation of style and typescript logic.
- **Auto-Save Loop:** Any direct mutation to the central preference runes triggers a debounced background save to Dexie.
- **Plugin Extensibility:** A system registry (`registerPreferenceSchema`) will allow future plugins to inject custom UI panels into the master Settings modal and safely isolate their settings alongside core preferences. **Strict Rule:** Plugins injecting CSS variables must use strict namespacing (e.g., `--plugin-maps-water-color`) to prevent global style pollution.

## Scratch Pad
*Status: Planned (v0.4.0)*

A floating persistent notepad that lives at the workspace level - outside the verse/chapter system entirely. It is the digital equivalent of a physical notepad sitting next to your Bible.

- **Component:** `src/lib/components/ScratchPad.svelte`, rendered inside `ReaderWorkspace` alongside the pane row. Toggled open/closed with Cmd+Shift+P.
- **Persistence:** A singleton Dexie `Settings` record under key `'scratchPad'` holding the raw content string and a `droppedVerses: { osisId, text, reference }[]` array. Same pattern as `UserPreferences` - one record, always present, never cleared by navigation.
- **Verse dropping:** While reading, the verse toolbar exposes a "Send to scratch pad" button (and drag-and-drop is supported). A dropped verse inserts a quoted block at the cursor position: the verse text with its OSIS reference as a label. The scratch pad is plain-text with these structured verse blocks interleaved.
- **"Convert to note":** A selection within the scratch pad can be promoted to a proper `Annotation` via a toolbar button. This opens the existing note editor pre-populated with the selection and any verse references it contains - the scratch pad remains unchanged (non-destructive promotion).
- **Design principle:** The scratch pad is intentionally not verse-anchored. Do not add per-verse or per-chapter scratch pads. The value is that it persists *across* navigation without asking where to save.

## Reading Logs & Velocity Tracking
*Status: Planned*
Honest tracking of actual time spent reading per chapter. Not gamified streaks, but strict observational presence and velocity data. This engine enables self-reflection, feeds spaced-repetition metrics, and powers visual activity plugins (e.g., GitHub-style contribution graphs).

## Doctrine Development Tracker
*Status: Planned (The Killer Feature)*
A user-editable living timeline of doctrinal history. Instead of just displaying pre-packaged schemas, it provides a full data-entry workflow. Users can log councils, curate patristic quotes, and draw explicit causal logic edges linking historical debates directly to biblical verses.

## Cross-References & Graph (Zoomable Scripture Graph)
*Status: Data model, query engine, and UI implemented (v0.4.0)*

A bidirectional graph mapping conceptual and lexical links between passages, designed to visualize scriptural connections using a node/edge data structure. The graph must be **practical for study** - usable and readable at every zoom level - not a visually impressive but unreadable hairball.

### Graph Data Model (Phase 2 - implemented)

The graph abstraction lives in `packages/core` and is entirely independent of any rendering layer.

**Node types (`GraphNodeType`):**

| Type | ID format | Example |
|---|---|---|
| `verse` | `verse:${osisId}` | `verse:Gen.1.1` |
| `book` | `book:${osisBookId}` | `book:Gen` |
| `chapter` | `chapter:${osisBookId}.${n}` | `chapter:Gen.1` |
| `person` | `person:${theographicId}` | `person:moses_1` |
| `place` | `place:${theographicId}` | `place:jerusalem_1` |
| `event` | `event:${theographicId}` | `event:exodus_1` |

Node IDs are namespaced with a type prefix to prevent collisions across datasets (e.g. the book "Mark" vs the person "Mark").

**Edge categories (`GraphEdgeCategory`):**

| Category | Source dataset | Storage |
|---|---|---|
| `cross-reference` | Dexie `crossReferences` table (~340K rows) | **Stored** - seeded from OpenBible/TSK; edge types (`quotation`, `allusion`, `parallel`, …) classified via the typed overlay datasets (OT-NT-Reference-Map, UBS Parallel Passages - see `parse-typed-overlays.ts`) |
| `entity-mention` | `person.verseRefs`, `place.verseRefs`, `event.verseRefs` | **Synthesized on demand** - never materialised as Dexie rows |
| `genealogy` | Dexie `relationships` table (v10) | **Stored** - seeded from Theographic family columns, supplemented by BibleData `PersonRelationship.csv` (see `importers/import-genealogy.ts`) |

**Stored vs. synthesized edges - the key architectural decision:**

Cross-reference edges are stored in Dexie because they are opaque data (we receive a link, not a derivable fact). Entity-mention edges are *not* stored because they are already implicit in `verseRefs` arrays on every Person/Place/Event record. Materialising them as ~2M Dexie rows would bloat the database, slow seeding, and create a synchronisation problem - the source arrays are already indexed and queryable in O(1). Phase 3 will synthesize entity-mention `GraphEdge` values in-memory when building a subgraph.

**Edge fields:**

```typescript
type GraphEdge = {
    id: string;          // deterministic - reuses CrossReference.id for cross-ref edges
    source: string;      // namespaced node ID, e.g. "verse:Gen.1.1"
    target: string;      // namespaced node ID, e.g. "verse:Jer.10.12"
    category: GraphEdgeCategory;
    type: string;        // CrossReferenceType for cross-ref; entity type for entity-mention
    weight?: number;     // community votes for cross-refs; 1 for synthesized edges
};
```

**Normalization helpers (`packages/core/src/graph.ts`):**

- `verseNodeId(osisId)` / `bookNodeId` / `chapterNodeId` / `personNodeId` / `placeNodeId` / `eventNodeId` - canonical ID constructors
- `crossReferenceToGraphEdge(ref)` - converts a stored `CrossReference` into a `GraphEdge`
- `makeVerseNode(osisId, label, data?)` - builds a `GraphNode` for a verse

### Graph Query Engine (Phase 3 - implemented)

Runtime traversal lives in `src/lib/engines/`. It never touches `packages/core` (no DB reads in core).

**`getNeighborhood(nodeId, hops, filters?)` - `src/lib/engines/graph.ts`:**

BFS starting from a `verse:` node ID. Each hop expands:
1. Cross-reference edges from the `crossReferences` Dexie table.
2. Entity-mention edges synthesized on demand from `person.verseRefs`, `place.verseRefs`, `event.verseRefs` - **never written to Dexie**.

Entity nodes (person/place/event) are **terminal leaves** - they do not expand further. Only verse nodes propagate the frontier to the next hop. This prevents combinatorial blowup when a heavily-mentioned person (e.g. David) would otherwise pull in hundreds of verses per hop.

**Node cap is mandatory and enforced in the engine, not the UI.** Default: 120. The cap is checked before adding each node - the result is always `≤ maxNodes` nodes regardless of filters. When the cap is hit, `truncated: true` is returned. The UI must not raise the cap beyond the default without an explicit user action.

```typescript
type GraphFilters = {
    edgeCategories?: GraphEdgeCategory[];  // default: all
    edgeTypes?: string[];                  // default: all (e.g. 'quotation' only)
    maxNodes?: number;                     // default: 120
    nodeTypes?: GraphNodeType[];           // default: all
};
```

**Deduplication:** Both node and edge maps are keyed by ID. Cross-reference edges fetched from both endpoints of an existing edge are idempotent (same ID, same data).

**`getNeighborhood` with 1 hop, `verse:John.3.16`** → returns all verses that cross-reference John 3:16, plus all persons/places/events whose `verseRefs` include `John.3.16`.

**`buildPersonSubgraph(personId, depth)` - `src/lib/engines/genealogy.ts`:**

BFS traversal over the `relationships` Dexie table (v10, seeded from Theographic family columns plus the BibleData supplement). Returns typed `GraphNode`/`GraphEdge` pairs for the person subgraph. See the engine file for the full implementation including the `RelationshipType` edge encoding.

**DB helpers added to `packages/db` (Phase 3):**

- `getCrossReferencesBetweenBooks(bookA, bookB)` - bidirectional, uses `sourceVerse` index range scan
- `getBookCrossReferenceMatrix()` - full table scan (~340K rows); returns a `Map<book, Map<book, count>>` for zoomed-out graph density views; cache the result - it only changes after a re-seed

**Progressive Disclosure Model:**
The graph uses semantic zoom with three levels. Complexity appears only as the user drills down - the renderer never dumps all verse-level links at once.

| Zoom level | Node granularity | What's visible | Interaction |
|---|---|---|---|
| **Zoomed out** | Books or major sections | Clustered nodes with weighted edges showing cross-reference density between books | Click cluster to expand; hover for summary card |
| **Mid zoom** | Chapters / passage groups | Individual chapter nodes within an expanded cluster; major cross-reference relationships | Click to expand further; double-click to collapse back |
| **Zoomed in** | Individual verses | Verse nodes with direct connection edges - only rendered for the focused cluster, never globally | Click any verse node to navigate to that passage in the reader |

**Visible node cap:** The renderer enforces a hard cap (~120 visible nodes). When a zoom/expand action would exceed this, the graph shows a "too many connections - zoom in or filter" message instead of rendering. This is a UX principle, not just a performance guard - a 500-node graph teaches the user nothing.

**Filtering:** Before the graph renders, users can filter by edge type (quotation, allusion, thematic echo, shared keyword) and by entity linkage (person, place, event). Filters reduce noise at the query level, not by hiding already-rendered elements.

**Hover integration:** Hovering any node at any zoom level shows a floating preview card with the passage text, reusing the verse hover preview infrastructure (v0.4.0). This lets users explore without navigating away.

**Graph UX Principles:**
- **Provenance Labels:** Cross-reference edges must specify *why* they link (e.g., direct quotation, thematic echo, allusion, shared keyword) to be useful for serious study.
- **Clarity over Flair:** Avoid chaotic full-database force layouts. Default to a 1-hop neighborhood within the zoomed-in level.
- **Depth Controls:** Users can expand to 2-hop or use a depth slider with a hard result cap.
- **Expand-on-click:** Allow targeted, incremental exploration per node at every zoom level.
- **Typed Edges:** Differentiate connection types visually (e.g., quotation, allusion, theme).

**Core vs. plugin boundary:** The graph data model (nodes, edges, cross-reference storage, query engine) is core. The rendering layer (clustering algorithm, force simulation, zoom transitions, node styling) is a first-party plugin following the same conventions as the genealogy viewer - an alternative renderer can replace it without modifying core.

**Genealogy Visualization (v0.4.0):**

*Routing - two surfaces, one engine:*
1. **Standalone route** (`/study/person/:id`): Full-featured viewer with depth slider, layout toggle, edge-type filter, and legend. Bookmarkable and shareable.
2. **Contextual panel**: Launched from "Who's Here?" or `EntityDetailPanel` in the reader. Opens as a focused mini-graph (depth 1–2) without leaving the reading context.

*Engine:* `src/lib/engines/genealogy.ts` exposes `buildPersonSubgraph(personId, depth)`, which performs a BFS across the `relationships` Dexie table and returns typed nodes and edges. The engine is core. The visualization layer ships as a built-in first-party feature but is architecturally decoupled so a plugin can provide an alternative renderer receiving the same subgraph payload.

*Rendering Modes:*
- **Tree Layout** (`d3.tree()`, top-down): Activated for explicit lineage passages (Matthew 1, Luke 3, Genesis 5) or via user toggle. Optimized for reading a single ancestry chain.
- **Force/Graph Layout** (D3 force simulation): Default for open person exploration. Draggable nodes, expand-on-click (adds one hop per click). Hard cap: depth 4 hops; node-count warning above a configurable threshold (e.g., >80 nodes) to prevent unreadable hairball layouts.

*Typed Edge Visual Encoding:*

| Relationship | Line Style |
|---|---|
| `father-of` / `mother-of` | Solid, weight 2 |
| `spouse-of` | Dashed pink |
| `sibling-of` | Dotted |
| `half-sibling-same-father` | Long-dash, low opacity |
| `ancestor-of` | Faint long-dash |

Node fill: patriarch (blue), matriarch (green), descendant (purple). Unresolved person IDs (name absent from `persons` table) render grey with a `?` label.

*Complexity Controls:*
- Depth slider (1–4 hops).
- Layout toggle: Tree ↔ Force.
- Edge-type filter: e.g., hide `ancestor-of` to isolate immediate family.
- Node-count cap warning to surface performance risk before rendering.

## Story Mode
*Status: Planned (v0.5.0)*

A guided narrative exploration mode that turns entity and event data into interactive journeys through major biblical storylines. Not a reading plan - a step-by-step walk through connected passages, events, people, and places within a single narrative thread.

**Data model (core):** A new `narratives` Dexie table:
```
narratives: 'id, slug, title, *steps'
```
Each step: `{ order: number, passageStart: string, passageEnd: string, eventId?: string, personIds: string[], placeIds: string[], caption: string }`. Seed narratives are bundled as static JSON from the data pipeline, derived from Theographic event chains and verse linkages. Users can also create custom narratives by assembling steps from existing entity data.

**Component:** `StoryModePlayer.svelte` - a first-party plugin that renders inside `ReaderWorkspace` as an alternative navigation mode. When active, it replaces the standard chapter navigation with a step-based control bar ("Previous" / "Next event" / step indicator) and drives `ReaderPane` to display the current step's passage.

**Integration with existing systems:**
- **Reader:** Reuses `ReaderPane` for scripture display - each step calls `goto()` to load the relevant chapter and `scrollToVerse()` to focus the passage range.
- **Entity panel:** Each step surfaces its linked persons, places, and events in `EntityDetailPanel` and "Who's Here?" automatically (no special wiring - the panel already reacts to the current chapter).
- **Navigation history:** Story Mode pushes to the navigation history stack so Alt+← works for backtracking within a narrative.
- **Timeline:** If the timeline view is active (v0.5.0), the current step's `eventId` highlights its position on the timeline.
- **Maps:** If maps are available (v0.4.0+), each step highlights the relevant place on the map.
- **Split view:** Story Mode can drive one pane in a split-view layout while the other pane remains in free navigation - useful for comparing a narrative passage against a parallel account.

**Core vs. plugin:** The `narratives` table and step data model are core because other features (search, cross-references, timeline) benefit from knowing narrative membership. The guided reading UI is a first-party plugin following plugin API conventions - it consumes core data through the same hooks available to third-party plugins.

## Dictionary Lookup on Double-Click
*Status: Implemented (v0.3.1)*

Widens the existing entity-click interaction from "click a pre-highlighted entity" to "double-click any word." The result surfaces in the existing `EntityDetailPanel` - no new UI component required.

**Lookup cascade (in order):**
1. Check `persons`, `places`, `events` tables for a matching Theographic entity → render the rich entity card.
2. Check `db.dictionary.where('term').equalsIgnoreCase(word)` → render the Easton's definition card.
3. Fallback → render a minimal card with the raw word and a "Search in Bible" link that fires a full-text concordance search.

**Word normalization:** Before each lookup, strip common English suffixes in order: `-ness`, `-tion`, `-ing`, `-ed`, `-s`. This covers the majority of inflected forms (e.g. "believed" → "believe", "nations" → "nation") without requiring a full NLP stemmer library. Run the lookup against both the raw form and the stemmed form; prefer the raw-form hit if both match.

**Design principle:** This reuses the `EntityDetailPanel` intentionally. Do not add a separate "dictionary popup" component - the panel already handles multiple content types and has the correct z-index, keyboard dismissal, and mobile touch behavior. The only new code is the double-click event handler on verse text and the lookup cascade.

## Plugin Extensibility
*Status: Planned*
The single most important architectural decision. Every non-core feature (e.g., commentaries, lexicons, Church Fathers) will be a plugin. Plugins will run in sandboxed iframes (UI) and Web Workers (data processing) communicating via a strict internal API defined in `packages/plugin-api`.

For a detailed breakdown of what belongs in core versus what belongs in a plugin, please see [Architectural Philosophy: Core vs. Plugins](./core-vs-plugins.md).

For a developer-facing contract defining plugin hooks, lifecycle events, and message passing, see the [Plugin API Stub](./plugin-api.md).

To see how Codex functions as a content ecosystem (specifically the future v2.x CI/CD integration with the `bibleapologist.com` Hygraph CMS), see the [Ecosystem Integration Plan](./ecosystem.md).
