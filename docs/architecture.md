# Architecture Overview

Codex Scriptura is structured as a modern, offline-first application. To ensure speed and reliability in environments with poor network connectivity, all core reads and writes happen against a local database.

## The Stack
-   **SvelteKit 5 (Runes):** The core application framework.
-   **Dexie.js:** A wrapper around IndexedDB for local, offline persistence.
-   **MiniSearch:** In-memory client-side indexing for immediate full-text search without a backend.
-   **Vanilla CSS:** Keeping styles light, clean, and custom.
-   **Data pipeline:** Node.js/tsx scripts in `packages/data-pipeline` for offline-first local CSV/XML parsing to JSON.

## Database Schema (Dexie)
The application relies on 5 core tables defined in `packages/db/src/index.ts`, along with planned additions for rich metadata logic:

1.  **Verses:** Compound indexed by `translationId+book+chapter` for instant chapter rendering.
2.  **Translations:** Metadata for available Bibles (e.g., KJV, WEB, OEB).
3.  **Annotations:** Highlights, notes, and bookmarks keyed to verse ranges (`verseStart`, `verseEnd`). Translation-agnostic via OSIS IDs. Supports bidirectional routing (clicking an annotation in a global list instantly loads its target chapter via SvelteKit `goto` without full page reloads).
4.  **Tags:** Organization system for annotations with user-defined taxonomy.
5.  **Settings:** User preferences (theme, font size, active translation).

*Planned additions (v0.3.0 - v0.4.0, structured for Open Data Sources):*
6.  **Persons:** `id`, `name`, `gender`, `alphaGroup`, `*verseRefs`
7.  **Places:** `id`, `name`, `slug`, `lat`, `lng`, `confidence`, `alphaGroup`, `*verseRefs`
8.  **Events:** `id`, `name`, `slug`, `yearNum`, `periodId`, `*verseRefs`
9.  **Periods:** `id`, `name`, `startYear`, `endYear`
10. **Dictionary:** `id`, `term`, `slug`, `definition`
11. **Relationships:** `id`, `personFrom`, `personTo`, `type` (types: `father-of`, `mother-of`, `spouse-of`, `sibling-of`, `half-sibling-same-father`, `ancestor-of`)
12. **Narratives** *(v0.5.0)*: `id`, `slug`, `title`, `*steps` — curated narrative paths through scripture. Each step links to a passage range, optional event, person IDs, place IDs, and a caption. Seed data from Theographic event chains; also user-creatable.


## Book Metadata Layer (Planned — v0.5.0)
*Status: Design phase*

Each book in the canonical `BOOKS` array will be extended with rich metadata:

| Field | Type | Examples |
|-------|------|----------|
| `canons` | `string[]` | `['protestant', 'catholic', 'orthodox']` |
| `manuscripts` | `string[]` | `['MT', 'LXX', 'DSS', 'Vulgate']` |
| `summary` | `string` | Brief scholarly overview of the book |
| `historicalContext` | `string` | Dating, authorship, provenance |

This is static reference data baked into `@codex-scriptura/core` — no new Dexie table is needed. The reader UI will surface this via a "Book Info" panel accessible from the book selector dropdown.

## Search Engine Architecture
*Status: Implemented (Basic) → Planned (Advanced)*
Full-text search is entirely client-side, powered by **MiniSearch** and populated directly from IndexedDB. It uses BM25 scoring with custom stop-word filtering and exact-phrase re-ranking. 

**UX Paradigm:**
- **Primary Interface (Cmd+K):** The universal command palette. Users type a verse, word, book, or note to get an instant stream of results and quick jumps without a page transition.
- **Advanced Mode (`/search`):** A dedicated route for heavy research workflows: advanced filtering, saved searches, and multi-translation comparisons.

The search pipeline will evolve as follows:
- **v0.2 / v0.3:** Command palette with instant verse/book jump, exact phrase re-ranking, and stop-word filters.
- **v0.3.0:** Concordance (Word Study) mode with exhaustive exact-word scan and inflection variant matching.
- **v0.4.0:** Strong's number lookup (`H430`) — blocked on acquiring Strong's-tagged source data; all code infrastructure ready.
- **v0.5.0:** Morphology-aware search (Greek/Hebrew inflections) — requires original-language tagged texts + morphological analyzer.
- **v0.4.0:** Semantic/topical search via metadata traversal.
- **v0.5.0:** Search indexing for user annotations and notes.
- **v1.0.0:** Advanced boolean query operators (`AND`, `OR`, `NOT`) in the `/search` panel.

## Verse Navigation & Flash
*Status: Infrastructure implemented (v0.2.1); annotation sidebar entry point pending (v0.3.1)*

Any jump-to-verse action draws the eye via a transient CSS animation. This is a pure reader navigation behavior — no database state is written, no annotation is created. The flash is always short-lived by design.

- **Trigger:** `goto()` (SvelteKit router) followed immediately by `tick().then(() => scrollToVerse(...))`. The `tick()` ensures the DOM is flushed post-navigation before the element is queried. Skip `goto()` if already on the correct chapter.
- **Engine:** `scrollToVerse(osisId)` in `src/lib/utils/navigation.ts` queries the verse `<span>` by `[data-osis]` attribute, scrolls it into view (`block: 'center'`), then removes and re-adds the `verse-flash` CSS class to restart the animation deterministically.
- **Animation:** `verse-flash` applies a 1.4s ease-out keyframe: transparent → `--color-accent-subtle` at 20% → transparent. The variable strictly follows the user's custom accent color from `UserPreferences`.
- **Entry Points:** Cmd+K palette results and `/search` result clicks are wired (v0.2.1). Annotation sidebar cross-chapter navigation is the remaining entry point (v0.3.1).
- **Design Principle:** This is intentionally not a database feature. Do not add persistence, "last-flashed verse" tracking, or notification state. Plugins that navigate to verses should call `scrollToVerse()` via the core navigation hook rather than implement their own scroll or flash logic.

## Navigation History
*Status: Planned (v0.3.1)*

An in-app session history stack that tracks verse-level context independent of (and in addition to) browser history. The browser back button navigates between SvelteKit routes but discards scroll position and verse focus; the navigation history stack preserves both.

- **Data shape:** `{ book: string, chapter: number, verseId: string | null, scrollTop: number }[]`. Stored in Dexie `Settings` under key `'navHistory'`. Cleared on tab close via `sessionStorage` flag; depth capped at 50 entries.
- **Push rule:** Every `goto()` or manual chapter navigation pushes the *current* position before navigating. Cross-reference follows and annotation jumps push automatically. Programmatic scroll-only movements (e.g. `scrollToVerse`) do not push — they are sub-navigation within the same chapter.
- **Alt+← ("Return") shortcut:** Pops the stack, calls `goto()` to restore the chapter if different, then calls `scrollToVerse()` with the stored verse ID. Intercepts the native browser Alt+← before it triggers the browser back button — the in-app stack is the intended target.
- **Breadcrumb display:** A compact strip at the bottom of the reader showing the last ~5 entries. Clicking any entry navigates directly (does not pop intermediate entries — it inserts the current position as a new push so the trail remains coherent).
- **Design principle:** This is not a reading log (no timestamps, no analytics). It is purely a navigation affordance. Do not conflate it with the v0.7.0 Reading Logs engine.

## Split View / Reader Workspace
*Status: Planned (v0.4.0; prerequisite refactor in v0.3.x)*

Split view tiles 1–3 independent reader panes side by side. This section documents the component architecture, state model, and key implementation constraints.

### Route & Components
The `/read` route does not change. It now renders `ReaderWorkspace.svelte` instead of a chapter view directly. Two new components are introduced:

| Component | Path | Responsibility |
|---|---|---|
| `ReaderWorkspace` | `src/lib/components/ReaderWorkspace.svelte` | Owns the `panes[]` array; renders the flex row, draggable dividers, and workspace toolbar; coordinates sync scroll |
| `ReaderPane` | `src/lib/components/ReaderPane.svelte` | A fully self-contained reader instance — owns its own Dexie verse query, scroll handler, and entity highlighting |

`EntityDetailPanel` remains **workspace-level** (outside the pane row). Clicking an entity in any pane opens the same shared detail panel so the UI never has competing panels.

### Pane State
```ts
type PaneState = {
  id: string;           // nanoid
  book: string;         // OSIS book ID e.g. 'Matt'
  chapter: number;
  translationId: string;
  scrollTop: number;
}
```
The workspace state is a `$state panes: PaneState[]`. It is persisted to the Dexie `Settings` table under key `'splitPanes'` so the layout survives page refresh.

### Draggable Divider
The divider between panes is implemented with `pointermove` events and `flex-basis` percentages rather than pixel widths. This ensures pane proportions are preserved across window resizes. Hit area: 4 px. Minimum pane width: 280 px (enforced by disabling the "+ Add pane" button rather than clamping mid-drag).

### Sync Scroll
Sync scroll is coordinated in `ReaderWorkspace`, not in individual panes. Each `ReaderPane` emits a `scroll` event; the workspace catches it and, when sync is enabled, calls `pane.scrollTo()` on all sibling panes using a **0–1 proportional fraction** of total scrollable height. Raw-pixel sync is intentionally avoided — panes displaying different books or translations have different content heights, and pixel-syncing would misalign them immediately.

### Workspace Toolbar
The toolbar (sync-scroll toggle and "+ Add pane" button) is hidden entirely in single-pane mode. It appears only when 2+ panes are open so the default reading experience is unchanged.

### Entry Points into Split View
1. "Split" icon button in the main chapter nav bar (top right, adjacent to the translation picker) — adds a second pane.
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

A floating persistent notepad that lives at the workspace level — outside the verse/chapter system entirely. It is the digital equivalent of a physical notepad sitting next to your Bible.

- **Component:** `src/lib/components/ScratchPad.svelte`, rendered inside `ReaderWorkspace` alongside the pane row. Toggled open/closed with Cmd+Shift+P.
- **Persistence:** A singleton Dexie `Settings` record under key `'scratchPad'` holding the raw content string and a `droppedVerses: { osisId, text, reference }[]` array. Same pattern as `UserPreferences` — one record, always present, never cleared by navigation.
- **Verse dropping:** While reading, the verse toolbar exposes a "Send to scratch pad" button (and drag-and-drop is supported). A dropped verse inserts a quoted block at the cursor position: the verse text with its OSIS reference as a label. The scratch pad is plain-text with these structured verse blocks interleaved.
- **"Convert to note":** A selection within the scratch pad can be promoted to a proper `Annotation` via a toolbar button. This opens the existing note editor pre-populated with the selection and any verse references it contains — the scratch pad remains unchanged (non-destructive promotion).
- **Design principle:** The scratch pad is intentionally not verse-anchored. Do not add per-verse or per-chapter scratch pads. The value is that it persists *across* navigation without asking where to save.

## Reading Logs & Velocity Tracking
*Status: Planned*
Honest tracking of actual time spent reading per chapter. Not gamified streaks, but strict observational presence and velocity data. This engine enables self-reflection, feeds spaced-repetition metrics, and powers visual activity plugins (e.g., GitHub-style contribution graphs).

## Doctrine Development Tracker
*Status: Planned (The Killer Feature)*
A user-editable living timeline of doctrinal history. Instead of just displaying pre-packaged schemas, it provides a full data-entry workflow. Users can log councils, curate patristic quotes, and draw explicit causal logic edges linking historical debates directly to biblical verses.

## Cross-References & Graph (Zoomable Scripture Graph)
*Status: Planned (v0.4.0)*
A bidirectional graph mapping conceptual and lexical links between passages, designed to visualize scriptural connections using a node/edge data structure. The graph must be **practical for study** — usable and readable at every zoom level — not a visually impressive but unreadable hairball.

**Progressive Disclosure Model:**
The graph uses semantic zoom with three levels. Complexity appears only as the user drills down — the renderer never dumps all verse-level links at once.

| Zoom level | Node granularity | What's visible | Interaction |
|---|---|---|---|
| **Zoomed out** | Books or major sections | Clustered nodes with weighted edges showing cross-reference density between books | Click cluster to expand; hover for summary card |
| **Mid zoom** | Chapters / passage groups | Individual chapter nodes within an expanded cluster; major cross-reference relationships | Click to expand further; double-click to collapse back |
| **Zoomed in** | Individual verses | Verse nodes with direct connection edges — only rendered for the focused cluster, never globally | Click any verse node to navigate to that passage in the reader |

**Visible node cap:** The renderer enforces a hard cap (~120 visible nodes). When a zoom/expand action would exceed this, the graph shows a "too many connections — zoom in or filter" message instead of rendering. This is a UX principle, not just a performance guard — a 500-node graph teaches the user nothing.

**Filtering:** Before the graph renders, users can filter by edge type (quotation, allusion, thematic echo, shared keyword) and by entity linkage (person, place, event). Filters reduce noise at the query level, not by hiding already-rendered elements.

**Hover integration:** Hovering any node at any zoom level shows a floating preview card with the passage text, reusing the verse hover preview infrastructure (v0.4.0). This lets users explore without navigating away.

**Graph UX Principles:**
- **Provenance Labels:** Cross-reference edges must specify *why* they link (e.g., direct quotation, thematic echo, allusion, shared keyword) to be useful for serious study.
- **Clarity over Flair:** Avoid chaotic full-database force layouts. Default to a 1-hop neighborhood within the zoomed-in level.
- **Depth Controls:** Users can expand to 2-hop or use a depth slider with a hard result cap.
- **Expand-on-click:** Allow targeted, incremental exploration per node at every zoom level.
- **Typed Edges:** Differentiate connection types visually (e.g., quotation, allusion, theme).

**Core vs. plugin boundary:** The graph data model (nodes, edges, cross-reference storage, query engine) is core. The rendering layer (clustering algorithm, force simulation, zoom transitions, node styling) is a first-party plugin following the same conventions as the genealogy viewer — an alternative renderer can replace it without modifying core.

**Genealogy Visualization (v0.4.0):**

*Routing — two surfaces, one engine:*
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

A guided narrative exploration mode that turns entity and event data into interactive journeys through major biblical storylines. Not a reading plan — a step-by-step walk through connected passages, events, people, and places within a single narrative thread.

**Data model (core):** A new `narratives` Dexie table:
```
narratives: 'id, slug, title, *steps'
```
Each step: `{ order: number, passageStart: string, passageEnd: string, eventId?: string, personIds: string[], placeIds: string[], caption: string }`. Seed narratives are bundled as static JSON from the data pipeline, derived from Theographic event chains and verse linkages. Users can also create custom narratives by assembling steps from existing entity data.

**Component:** `StoryModePlayer.svelte` — a first-party plugin that renders inside `ReaderWorkspace` as an alternative navigation mode. When active, it replaces the standard chapter navigation with a step-based control bar ("Previous" / "Next event" / step indicator) and drives `ReaderPane` to display the current step's passage.

**Integration with existing systems:**
- **Reader:** Reuses `ReaderPane` for scripture display — each step calls `goto()` to load the relevant chapter and `scrollToVerse()` to focus the passage range.
- **Entity panel:** Each step surfaces its linked persons, places, and events in `EntityDetailPanel` and "Who's Here?" automatically (no special wiring — the panel already reacts to the current chapter).
- **Navigation history:** Story Mode pushes to the navigation history stack so Alt+← works for backtracking within a narrative.
- **Timeline:** If the timeline view is active (v0.5.0), the current step's `eventId` highlights its position on the timeline.
- **Maps:** If maps are available (v0.4.0+), each step highlights the relevant place on the map.
- **Split view:** Story Mode can drive one pane in a split-view layout while the other pane remains in free navigation — useful for comparing a narrative passage against a parallel account.

**Core vs. plugin:** The `narratives` table and step data model are core because other features (search, cross-references, timeline) benefit from knowing narrative membership. The guided reading UI is a first-party plugin following plugin API conventions — it consumes core data through the same hooks available to third-party plugins.

## Dictionary Lookup on Double-Click
*Status: Planned (v0.3.1)*

Widens the existing entity-click interaction from "click a pre-highlighted entity" to "double-click any word." The result surfaces in the existing `EntityDetailPanel` — no new UI component required.

**Lookup cascade (in order):**
1. Check `persons`, `places`, `events` tables for a matching Theographic entity → render the rich entity card.
2. Check `db.dictionary.where('term').equalsIgnoreCase(word)` → render the Easton's definition card.
3. Fallback → render a minimal card with the raw word and a "Search in Bible" link that fires a full-text concordance search.

**Word normalization:** Before each lookup, strip common English suffixes in order: `-ness`, `-tion`, `-ing`, `-ed`, `-s`. This covers the majority of inflected forms (e.g. "believed" → "believe", "nations" → "nation") without requiring a full NLP stemmer library. Run the lookup against both the raw form and the stemmed form; prefer the raw-form hit if both match.

**Design principle:** This reuses the `EntityDetailPanel` intentionally. Do not add a separate "dictionary popup" component — the panel already handles multiple content types and has the correct z-index, keyboard dismissal, and mobile touch behavior. The only new code is the double-click event handler on verse text and the lookup cascade.

## Plugin Extensibility
*Status: Planned*
The single most important architectural decision. Every non-core feature (e.g., commentaries, lexicons, Church Fathers) will be a plugin. Plugins will run in sandboxed iframes (UI) and Web Workers (data processing) communicating via a strict internal API defined in `packages/plugin-api`.

For a detailed breakdown of what belongs in core versus what belongs in a plugin, please see [Architectural Philosophy: Core vs. Plugins](./core-vs-plugins.md).

For a developer-facing contract defining plugin hooks, lifecycle events, and message passing, see the [Plugin API Stub](./plugin-api.md).

To see how Codex functions as a content ecosystem (specifically the future v2.x CI/CD integration with the `bibleapologist.com` Hygraph CMS), see the [Ecosystem Integration Plan](./ecosystem.md).
