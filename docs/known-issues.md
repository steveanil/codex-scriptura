# Known Issues & Hardening Backlog

> **Status:** Living document. Findings from the July 2026 full-codebase review.
> Items are removed when fixed (with the fixing commit noted in the PR).
> Severity: **Critical** = wrong/missing scripture data or data loss risk;
> **High** = user-visible malfunction; **Medium** = correctness edge case or
> performance; **Low** = hygiene/consistency.

---

## Critical — Data Accuracy

### 1. ~~Footnote and study-note text leaks into verse text~~ — **FIXED 2026-07-15**
- **Was:** Both importers stripped XML *tags* but kept the *content* of note elements — 2,514 WEB `<f>` footnotes + 358 `<x>` cross-ref notes and 48 OEB `<note>` bodies were merged into verse text (WEB Gen 1:1 read *"…God The Hebrew word rendered "God" is "אֱלֹהִ֑ים" (Elohim). created…"*).
- **Fix shipped:** `core/xml.ts removeElements()` removes note elements with their content *before* lemma extraction, wj-offset computation, and text stripping, so words-of-Jesus offsets stay aligned. Dexie **v16** clears `verses` + `searchIndexes` for re-seed. Covered by `importers/import-texts.test.ts`. Verified: 0 remaining leaks across all three translations; the 25 WEB + 19 OEB records whose entire content was an omission footnote ("Some manuscripts add…") correctly no longer appear as scripture.
- **Future option (still open):** extract footnotes into their own field/table instead of discarding — translation footnotes are useful study data.

### 2. ~~Bridged verses are silently dropped (WEB)~~ — **FIXED 2026-07-15**
- **Was:** The `<v id="(\d+)"` token regex never matched bridges like `<v id="15-16"/>`, so bridged content was skipped.
- **Fix shipped:** importer parses `id="(\d+)(?:-(\d+))?"`, stores the entry under the first verse number with a new optional `verseEnd` field (`VerseRecord`, `RawVerse`, seed passthrough), and `ReaderPane` renders the label as "15–16". In the current WEB source all 5 bridges turn out to be omission placeholders (footnote-only → correctly empty after fix #1); the support is load-bearing for future translations with real bridged text. Covered by `importers/import-texts.test.ts`.
- ~~Cross-references targeting the *second* verse of a bridge don't resolve~~ — **FIXED 2026-07-15**: `getVerse()` falls back to the bridge record covering the requested verse number (unit-tested).

### 3. ~~No versification validation in the pipeline~~ — **FIXED 2026-07-15**
- **Shipped:**
  1. `validate-texts.ts` pipeline stage (runs automatically at the end of `import:all`; also `pnpm run validate:texts`): checks duplicates, unknown books, empty text, chapter counts vs the canonical table, bridge overlaps, and per-chapter verse gaps. Gaps are classified against `KNOWN_VERSE_GAPS` — a fully source-verified list of text-critical omissions (Acts 8:37 class) and source versification skips (Greek Esther, Prayer of Azariah, Sirach "best authorities" bridges). Handles Apocrypha numbering variants (EpJer as Baruch 6, AddPs as Psalm 151, sparse Greek Esther chapters). Report written to `data/processed/_metadata/text-validation.json`; hard errors fail the pipeline. All three current translations validate clean.
  2. Golden-sample tests (`golden-texts.test.ts`): exact-text assertions for anchor verses per translation plus a leaked-footnote-phrase sweep; they run wherever the pipeline data exists and skip cleanly in CI.
- **Documented limitation:** omissions of a chapter's *last* verse(s) (e.g. WEB Sir 20:32, Rom 16:25–27) are undetectable by gap analysis — max-verse shrinks instead of leaving a hole. Detecting those requires a per-chapter canonical verse-count table (future enhancement, alongside the multi-versification mapping layer needed for non-KJV-versified translations).

---

## High

### 4. ~~`seedTranslation` never checks the fetch response~~ — **FIXED 2026-07-15**
All seeders now go through `fetchJsonAsset()` (`src/lib/seed.ts`), which checks `res.ok` **and** validates the body parses as JSON — catching SPA hosts that serve `index.html` with HTTP 200 for missing files. Each `seedAll()` step is individually try/caught so one dataset failing never aborts the rest. UI surfacing of failures remains open under #16.

### 5. ~~Chapter-loading race conditions~~ — **FIXED 2026-07-15**
Both `loadChapter` implementations (`ReaderWorkspace.svelte`, `PaneState`) now use an incrementing generation counter and bail before every state assignment when stale — rapid navigation can no longer interleave verses/annotations/enrichment from different chapters.

### 6. ~~Service-worker offline fallback is never pre-cached~~ — **FIXED 2026-07-15**
`service-worker.ts` now caches `prerendered` pages in `ASSETS` and explicitly caches `/index.html` (best-effort — the dev server doesn't serve it). Verified present in the production build output.

### 7. ~~IndexedDB persistence is never requested~~ — **FIXED 2026-07-15**
`+layout.svelte` requests `navigator.storage.persist()` at boot (non-blocking). Settings gained a **Storage** panel showing persistence status (with a manual "Request persistence" retry) and a `storage.estimate()` usage meter.

---

## Medium

### 8. ~~`navHistory.goBack()` can silently eat history entries~~ — **FIXED 2026-07-15**
`goBack()` now walks back past stack keys whose entries were evicted (entries cap 6, stack cap 20) instead of consuming the stack and returning nothing; `canGoBack` mirrors the same check so the button never lights up with no target. Docs correction: tab-close clearing *does* exist (a `beforeunload` listener in `+layout.svelte`, not the "sessionStorage flag" the docs claimed) — `architecture.md` now describes the actual mechanism and caps. Note `beforeunload` is best-effort (may not fire on mobile/crash).

### 9. ~~`indexOf(-1)` edge case in prev/next chapter~~ — **FIXED 2026-07-15**
Both implementations now navigate to the *nearest* earlier/later chapter (`find` on the chapter list) instead of `indexOf ± 1`, which behaves correctly when the current chapter doesn't exist in the active translation.

### 10. ~~`switchTranslation` doesn't validate the current book exists~~ — **FIXED 2026-07-15**
Both implementations fall back to the first available book (and validate the chapter) when the target translation lacks the current one. A user-visible notice ("Jude is not available in OEB") remains a nice-to-have for when a toast system exists.

### 11. ~~Unescaped `{@html}` in search results~~ — **FIXED 2026-07-15**
The search page now matches against the original text and assembles output with every segment HTML-escaped (`markMatches()` + `escapeHtml()`), including the no-match passthrough paths.

### 12. ~~`getBookList` / `getChapterList` load every verse into memory~~ — **FIXED 2026-07-15**
Both are now index-only `uniqueKeys()` range scans on `[translationId+book+chapter]` (~1 key per chapter instead of ~31K hydrated records). Covered by `packages/db/src/index.test.ts` (fake-indexeddb). Storing the lists on the `Translation` record at seed time remains a further option when the translation library grows.

---

## Low / Hygiene

### 13. Docs claim split-view features that don't exist
`roadmap.md` and `architecture.md` mark sync-scroll, the workspace toolbar, and draggable flex-basis dividers as implemented. `ReaderWorkspace.svelte` contains none of them (panes are fixed `flex: 1`). Either implement or re-open the roadmap items. *(Roadmap has been corrected to reflect reality — the items are re-opened.)*

### 14. Pane 0 is special-cased; navigation logic exists twice and has diverged
The primary pane uses workspace-local `$state` while extra panes use `PaneState`. The two `loadChapter` copies already behave differently (workspace falls forward *and* backward through empty chapters; `PaneState` only falls forward). Unify pane 0 onto `PaneState` and delete the duplicate. Also part of decomposing the 1,100+-line `ReaderWorkspace`.

### 15. Assorted
- ~~`restoreExtraPaneLocations(defaultTranslation)` ignores its parameter~~ — **FIXED 2026-07-15** (parameter removed).
- `navHistory` writes a non-`UserPreferences` record into the typed `settings` table via `as any` — move to its own key/value store or a dedicated table before v0.8.0 export enumerates "all user data."
- Persistence is scattered across three mechanisms (preferences in Dexie, split panes in `localStorage`, nav history in the Dexie settings table). Consolidate on Dexie.
- ~~`navigateToAnnotation` doesn't `visitCurrent()` before navigating~~ — **FIXED 2026-07-15** (now mirrors `navigateToVerse`).

### 16. Silent failure everywhere on first run
Seed errors go to `console.warn`; the UI has no "data failed to load" state and no progress indication during the 1–2 minute first seed. Add a first-run screen with per-dataset progress and error surfacing. (Tracked on the roadmap under v0.9.0 onboarding, but the error-surfacing half should land sooner.)

### 17. Heavy work on the main thread
MiniSearch index build (~31K verses), `wordSearch` full scans, and the 340K-row book-matrix scan all block the UI thread. Web Workers are scheduled for v0.9.0 — pull forward to whenever another translation or the morphology layer lands, since jank scales linearly with data size. The same worker infrastructure is a prerequisite for local semantic search (roadmap v0.4.0+).

---

## UX Gaps Observed (not bugs)

- Hover-only affordances (verse preview cards, graph node previews) have no touch equivalent — long-press should map to hover.
- Mobile hides chapter pills with no replacement gesture — add swipe left/right for prev/next chapter.
- No keyboard-shortcut reference (a `?` overlay listing Cmd+K, Cmd+\, Alt+←, etc.).
- Blank panels while loading — add skeleton states for reader, entity panels, and graph.
- No storage/usage indicator in Settings (pairs with #7).

These are folded into the v0.9.0 polish milestone in `roadmap.md`.
