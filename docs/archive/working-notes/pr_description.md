# Comprehensive Reader UI, Annotations, and Search Update

## Summary
This PR finalizes the core functionality of the v0.2.0 Annotate milestone and resolves several critical reader navigation, data integrity, and search relevance issues.

## Detailed Changes

### Annotations & UI
- **Annotation Sidebar:** Built a slide-out drawer for rich-text note entry and a chapter-specific note feed.
- **Floating Toolbar:** Added a sticky toolbar for multi-colored highlights, note creation, and text copying.
- **Multi-Verse Selection:** Added DOM-based Shift+Click range support for selecting multiple contiguous verses.
- **UI Tweaks:** Converted vertical mouse wheel events to horizontal scrolling for chapter pills. Replaced the clunky floating "reopen sidebar" button with a sleek 48px icon-rail sidebar when collapsed.

### Bug Fixes & Data Integrity
- **IndexedDB Proxy Error:** Fixed Svelte 5 $state DataCloneError by spreading Proxy arrays before passing them to Dexie.
- **Dexie Schema Upgrade:** Bumped Dexie to v2 to ensure proper index creation (`book`) for cross-translation annotation queries without wiping existing databases.
- **Canonical Ordering:** Fixed a bug where [getBookList()](file:///home/steveaj/Projects/codex-scriptura/packages/db/src/index.ts#58-72) relied on random Set iteration order. Books now strictly follow the canonical BOOKS array (Genesis → Revelation).
- **Apocryphal Data Gaps:** Added 3 missing apocryphal books to the canon list (EsthGr, EpJer, 2Esd) to fix phantom navigation states from KJV OSIS imports.
- **Phantom Chapter Guards:** Implemented auto-skip logic for empty chapters (e.g. Greek Esther 1-9) so the reader seamlessly jumps to the first chapter containing actual text.

### Search Engine Relevance
- **Stop Word Filters:** Implemented a `processTerm` filter in MiniSearch to strip 33 highly common words (the, and, of, in...), drastically reducing noise.
- **Dynamic Fuzzy Matching:** Tuned the fuzzy matcher to require exact/prefix matches for short words (<=4 chars) to prevent unrelated results.
- **Exact Phrase Re-ranking:** Re-wrote the search loop to apply a massive BM25 score boost (+50) to verses containing the exact queried phrase seamlessly (fixes the "in the beginning God" Gen 1:1 prioritization issue).

## Verification Checklist
- [x] Run `pnpm run check` (0 errors)
- [x] Run `pnpm run build` (success, adapter-static generation)
- [x] Tested Dexie v1 -> v2 migration (safely adds the `book` index)
- [x] Verified exact-phrase search ranks Gen 1:1 #1 over John 1:1

---

*Note: Reviewers running this branch locally should clear their IndexedDB via DevTools Application -> Storage to force the Dexie v2 schema upgrade if annotations are failing to save.*
