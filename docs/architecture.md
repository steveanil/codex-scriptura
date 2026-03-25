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
3.  **Annotations:** Highlights, notes, and bookmarks keyed to verse ranges (`verseStart`, `verseEnd`).
4.  **Tags:** Organization system for annotations.
5.  **Settings:** User preferences (theme, font size, active translation).

## Cross-References & Graph
*Status: Planned*
A bidirectional graph mapping conceptual and lexical links between passages, designed to visualize scriptural connections using a node/edge data structure.

## Plugin Extensibility
*Status: Planned*
The single most important architectural decision. Every non-core feature (e.g., commentaries, lexicons, Church Fathers) will be a plugin. Plugins will run in sandboxed iframes (UI) and Web Workers (data processing) communicating via a strict internal API defined in `packages/plugin-api`.
