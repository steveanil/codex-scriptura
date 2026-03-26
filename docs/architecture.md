# Architecture Overview

Codex Scriptura is structured as a modern, offline-first application. To ensure speed and reliability in environments with poor network connectivity, all core reads and writes happen against a local database.

## The Stack
-   **SvelteKit 5 (Runes):** The core application framework.
-   **Dexie.js:** A wrapper around IndexedDB for local, offline persistence.
-   **MiniSearch:** In-memory client-side indexing for immediate full-text search without a backend.
-   **Vanilla CSS:** Keeping styles light, clean, and custom.

## Database Schema (Dexie)
The application relies on 5 core tables defined in `packages/db/src/index.ts`, along with planned additions for rich metadata logic:

1.  **Verses:** Compound indexed by `translationId+book+chapter` for instant chapter rendering.
2.  **Translations:** Metadata for available Bibles (e.g., KJV, WEB, OEB).
3.  **Annotations:** Highlights, notes, and bookmarks keyed to verse ranges (`verseStart`, `verseEnd`). Translation-agnostic via OSIS IDs. Supports bidirectional routing (clicking an annotation in a global list instantly loads its target chapter via SvelteKit `goto` without full page reloads).
4.  **Tags:** Organization system for annotations with user-defined taxonomy.
5.  **Settings:** User preferences (theme, font size, active translation).

*Planned additions (v0.3.0 - v0.4.0, structured for Open Data Sources):*
6.  **Persons:** Biographical data, linked to verse references (`*verseRefs`).
7.  **Places:** Geography data containing GPS coordinates, linked to verse references (`*verseRefs`).
8.  **Events:** Chronological data, linked to verse references (`*verseRefs`).
9.  **Dictionary:** Terms and definitions (e.g. from Easton's Bible Dictionary).
10. **Relationships:** Directed edges between persons (`personFrom`, `personTo`, `type`) for genealogy tree generation.


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
- **v0.3.0:** Morphology-aware search (inflections) and Strong's number lookup (`H430`).
- **v0.4.0:** Semantic/topical search via metadata traversal.
- **v0.5.0:** Search indexing for user annotations and notes.
- **v1.0.0:** Advanced boolean query operators (`AND`, `OR`, `NOT`) in the `/search` panel.

## Preferences & Theming System
*Status: Planned (v0.3.0)*
A reactive, offline-first preferences engine ensuring instant UI updates and plugin extensibility.

- **Data Model:** A singleton `UserPreferences` interface tracking `theme`, `accentColor`, `fontOptions` (size, grouping by language context), `readerOptions` (layout density, parallel/interlinear toggles), and `highlightPresets`.
- **Storage Context:** Persisted locally in the Dexie `Settings` table under a permanent `'default'` ID to avoid multi-row fragmentation.
- **State Management:** Powered globally by Svelte 5 Runes. On app boot, preferences load from IndexedDB into a root `$state` object.
- **DOM Integration:** A Svelte `$effect` actively proxies rune properties into root CSS Custom Properties (e.g., `--color-accent`, `--font-scripture`, `--layout-gap`) on the `document.documentElement`, ensuring zero UI judder and absolute separation of style and typescript logic.
- **Auto-Save Loop:** Any direct mutation to the central preference runes triggers a debounced background save to Dexie.
- **Plugin Extensibility:** A system registry (`registerPreferenceSchema`) will allow future plugins to inject custom UI panels into the master Settings modal and safely isolate their settings alongside core preferences. **Strict Rule:** Plugins injecting CSS variables must use strict namespacing (e.g., `--plugin-maps-water-color`) to prevent global style pollution.

## Reading Logs & Velocity Tracking
*Status: Planned*
Honest tracking of actual time spent reading per chapter. Not gamified streaks, but strict observational presence and velocity data. This engine enables self-reflection, feeds spaced-repetition metrics, and powers visual activity plugins (e.g., GitHub-style contribution graphs).

## Doctrine Development Tracker
*Status: Planned (The Killer Feature)*
A user-editable living timeline of doctrinal history. Instead of just displaying pre-packaged schemas, it provides a full data-entry workflow. Users can log councils, curate patristic quotes, and draw explicit causal logic edges linking historical debates directly to biblical verses.

## Cross-References & Graph
*Status: Planned*
A bidirectional graph mapping conceptual and lexical links between passages, designed to visualize scriptural connections using a node/edge data structure. 

**Graph UX Principles (v0.4.0):**
- **Provenance Labels:** Cross-reference edges must specify *why* they link (e.g., direct quotation, thematic echo, allusion, shared keyword) to be useful for serious study.
- **Clarity over Flair:** Avoid chaotic full-database force layouts. Default to a 1-hop neighborhood.
- **Depth Controls:** Users can expand to 2-hop or use a depth slider with a hard result cap.
- **Expand-on-click:** Allow targeted, incremental exploration per node.
- **Typed Edges:** Differentiate connection types visually (e.g., quotation, allusion, theme).

## Plugin Extensibility
*Status: Planned*
The single most important architectural decision. Every non-core feature (e.g., commentaries, lexicons, Church Fathers) will be a plugin. Plugins will run in sandboxed iframes (UI) and Web Workers (data processing) communicating via a strict internal API defined in `packages/plugin-api`.

For a detailed breakdown of what belongs in core versus what belongs in a plugin, please see [Architectural Philosophy: Core vs. Plugins](./core-vs-plugins.md).

For a developer-facing contract defining plugin hooks, lifecycle events, and message passing, see the [Plugin API Stub](./plugin-api.md).

To see how Codex functions as a content ecosystem (specifically the future v2.x CI/CD integration with the `bibleapologist.com` Hygraph CMS), see the [Ecosystem Integration Plan](./ecosystem.md).
