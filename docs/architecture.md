# Architecture Overview

Codex Scriptura is structured as a modern, offline-first application. To ensure speed and reliability in environments with poor network connectivity, all core reads and writes happen against a local database.

## The Stack
-   **SvelteKit 5 (Runes):** The core application framework.
-   **Dexie.js:** A wrapper around IndexedDB for local, offline persistence.
-   **MiniSearch:** In-memory client-side indexing for immediate full-text search without a backend.
-   **Vanilla CSS:** Keeping styles light, clean, and custom.

## Database Schema (Dexie)
The application relies on 5 core tables defined in `packages/db/src/index.ts`:

1.  **Verses:** Compound indexed by `translationId+book+chapter` for instant chapter rendering.
2.  **Translations:** Metadata for available Bibles (e.g., KJV, WEB, OEB).
3.  **Annotations:** Highlights, notes, and bookmarks keyed to verse ranges (`verseStart`, `verseEnd`). Translation-agnostic via OSIS IDs.
4.  **Tags:** Organization system for annotations with user-defined taxonomy.
5.  **Settings:** User preferences (theme, font size, active translation).

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
Full-text search is entirely client-side, powered by **MiniSearch** and populated directly from IndexedDB. It uses BM25 scoring with custom stop-word filtering and exact-phrase re-ranking. The search pipeline is designed to evolve:
- **v0.1 / v0.2:** Exact phrase re-ranking, stop-word filters, and multi-translation search.
- **v0.3.0:** Morphology-aware search (inflections) and Strong's number lookup (`H430`).
- **v0.4.0:** Semantic/topical search via graph traversal and direct reference jumping (`John 3:16`).
- **v0.5.0:** Search indexing for user annotations and notes.
- **v1.0.0:** Advanced boolean query operators (`AND`, `OR`, `NOT`).

## Cross-References & Graph
*Status: Planned*
A bidirectional graph mapping conceptual and lexical links between passages, designed to visualize scriptural connections using a node/edge data structure.

## Plugin Extensibility
*Status: Planned*
The single most important architectural decision. Every non-core feature (e.g., commentaries, lexicons, Church Fathers) will be a plugin. Plugins will run in sandboxed iframes (UI) and Web Workers (data processing) communicating via a strict internal API defined in `packages/plugin-api`.
