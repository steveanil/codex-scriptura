# v0.2.0 Annotate

Welcome to the Annotate milestone release of Codex Scriptura. This release introduces offline-first highlights, rich-text notes, and significantly smarter search capabilities.

## New Features
- **Highlighting:** Select any verse (or Shift+Click to select a range) and use the floating toolbar to apply multiple highlight colors.
- **Rich-Text Notes:** Write detailed study notes directly attached to verses using the new slide-out Annotation Sidebar.
- **Tagging System:** Organize your thoughts with custom tags (#theology, #grace) that sync to a global, auto-completing database. All annotations persist instantly to your local device (IndexedDB) and are fully translation-agnostic via underlying OSIS references.

## Improvements
- **Exact Phrase Search Boosting:** Searching for "in the beginning God" will now guarantee Genesis 1:1 appears at the absolute top of the results, rather than prioritizing verses with higher word counts.
- **Search Noise Reduction:** Added intelligent stop-word filtering and tuned fuzzy matching to ignore filler words and prevent short-word typos from polluting results.
- **Horizontal Chapter Scroll:** The chapter navigation bar now natively translates vertical mouse scrolling into horizontal movement.
- **Icon Rail Sidebar:** When you collapse the main sidebar, it now elegantly shrinks into a 48px icon rail to save maximum screen real estate without hiding navigation controls.
- **Smart Navigation Controls:** The "Next/Prev Chapter" arrows now intelligently skip empty chapters and properly cross book boundaries.
- **Database Architecture:** Bumped internal Dexie schema to v2 to support cross-translation annotation queries via a new `book` index string.

## Bug Fixes
- Prevented Svelte 5 DataCloneError in IndexedDB writes by un-wrapping $state Proxy arrays.
- Fixed a bug causing the internal [getBookList()](file:///home/steveaj/Projects/codex-scriptura/packages/db/src/index.ts#58-72) to return books in arbitrary Set-iteration order instead of canonical order.
- Added support for isolated apocryphal books like 2 Esdras and the Epistle of Jeremiah found in certain KJV data sources, solving broken navigation loops.

---

### Installation / Upgrade Info
If you are upgrading from an earlier snapshot and encounter issues saving notes, please clear your browser site data (Application -> Storage -> Clear site data) to force Codex Scriptura to cleanly migrate the local database.
