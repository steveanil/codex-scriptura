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
- **Still open (minor):** cross-references targeting the *second* verse of a bridge (e.g. `Sir.1.6` when text lives on `Sir.1.5`) don't resolve to the bridge record.

### 3. No versification validation in the pipeline
- **Where:** pipeline-wide (no validation stage exists)
- **What:** Nothing checks imported verse counts against expected canonical counts, so bugs like #1 and #2 ship silently. There is also no handling for versification *differences* between traditions (Hebrew vs. English Psalm numbering, LXX offsets, 3 John 15, Rev 12:18) — currently latent, but will surface the moment non-KJV-versified translations are added.
- **Fix (staged):**
  1. Add a `validate-texts.ts` pipeline stage: per-book chapter counts and per-chapter verse counts compared against a canonical versification table; anomalies (missing/extra/bridged) printed as a report and written to `data/processed/_metadata/`.
  2. Golden-sample tests in vitest: exact expected text for a handful of anchor verses (Gen 1:1, John 3:16, Rev 22:21) per translation — catches note leakage and encoding regressions permanently.
  3. (Later, multi-versification support) a versification mapping layer keyed per translation.

---

## High

### 4. `seedTranslation` never checks the fetch response
- **Where:** `src/lib/seed.ts:38`
- **What:** Every other seeder checks `res.ok`; this one doesn't. Deployed behind an SPA-fallback host, a missing `*-verses.json` returns `index.html` with HTTP 200, so `res.json()` throws — which also aborts the rest of `seedAll()` (cross-references, genealogy, lexicon never seed).
- **Fix:** Check `res.ok` **and** `content-type: application/json` in *all* seeders (the SPA fallback defeats `res.ok` alone). Wrap each seed step so one failure doesn't abort the others, and surface failures in the UI (see #16).

### 5. Chapter-loading race conditions
- **Where:** `src/lib/components/ReaderWorkspace.svelte` (`loadChapter`), `src/lib/stores/splitPanes.svelte.ts` (`PaneState.loadChapter`)
- **What:** No request-generation guard. Two rapid navigations interleave; the slower one wins. `enrichment` is also assigned *after* `loading = false`, so a stale request can attach chapter A's "Who's Here?" data to chapter B's verses.
- **Fix:** Incrementing request ID captured at function start; bail before every state assignment if stale.

### 6. Service-worker offline fallback is never pre-cached
- **Where:** `src/service-worker.ts:73`
- **What:** The offline path does `cache.match('/index.html')`, but the SPA fallback page is in neither `build` (immutable assets) nor `files` (static dir), so it is never in the cache. Offline navigation to a not-yet-visited URL throws instead of loading the app shell.
- **Fix:** Add the fallback page (and the `prerendered` export from `$service-worker`) to `ASSETS` at install time.

### 7. IndexedDB persistence is never requested
- **Where:** app boot (no call site exists)
- **What:** The app stores 100K+ rows (~3 translations + 340K cross-refs) in best-effort storage. Under storage pressure the browser may evict the entire database — catastrophic for an offline-first app whose pitch is "your library is always available."
- **Fix:** Call `navigator.storage.persist()` on first seed; show the result in Settings (e.g. "Storage: persistent ✓ / best-effort ⚠") together with a `navigator.storage.estimate()` usage meter.

---

## Medium

### 8. `navHistory.goBack()` can silently eat history entries
- **Where:** `src/lib/stores/navHistory.svelte.ts:60`
- **What:** `backStack` keeps 20 keys but `entries` evicts at 6. When the previous key has been evicted, `goBack()` pops the stack, finds nothing, and returns `undefined` — the click does nothing *and* the entry is consumed. Additionally, `architecture.md` says history "clears on tab close via a sessionStorage flag," but no such clearing exists — history persists across sessions, contradicting the documented design.
- **Fix:** Either look up the entry *before* popping (and skip keys with no surviving entry), or store full entries on the back stack. Decide whether tab-close clearing is still wanted and make code and docs agree.

### 9. `indexOf(-1)` edge case in prev/next chapter
- **Where:** `src/lib/components/ReaderWorkspace.svelte` (`prevChapter`/`nextChapter`), `src/lib/stores/splitPanes.svelte.ts` (same methods)
- **What:** If `currentChapter` isn't in `availableChapters` (possible after switching to a translation missing that chapter), `curIdx` is `-1`: "previous" jumps to the previous *book*, "next" jumps to the first chapter.
- **Fix:** Clamp to the nearest valid chapter when `indexOf` misses.

### 10. `switchTranslation` doesn't validate the current book exists
- **Where:** both `switchTranslation` implementations
- **What:** Switching to a translation that lacks the current book (e.g. OEB's incomplete canon — 11,722 verses vs. WEB's 36,705) leaves an empty reader with no message.
- **Fix:** After `loadNavigation()`, if the current book is absent, fall back to the first available book and show a small notice ("Jude is not available in OEB").

### 11. Unescaped `{@html}` in search results
- **Where:** `src/routes/search/+page.svelte:310–334` (`highlightMatch`, `highlightConcordanceMatch`)
- **What:** Verse text is interpolated into `{@html}` without escaping (only `<mark>` wrappers are intended). `ReaderPane.svelte` does this correctly with `escapeHtml`; the search page skips it. Low exploitability today (our own data), but it becomes an XSS vector the moment search covers user notes or plugin-supplied datasets.
- **Fix:** Escape the text first, then wrap matches.

### 12. `getBookList` / `getChapterList` load every verse into memory
- **Where:** `packages/db/src/index.ts:202,217`
- **What:** Deriving 66 book names deserializes ~31K verse records — on every navigation load, per pane.
- **Fix:** Use `uniqueKeys()` on an index range, or better: compute book/chapter lists once at seed time and store them on the `Translation` record. Prerequisite for the translation-library expansion (a dozen translations must not mean a dozen full scans).

---

## Low / Hygiene

### 13. Docs claim split-view features that don't exist
`roadmap.md` and `architecture.md` mark sync-scroll, the workspace toolbar, and draggable flex-basis dividers as implemented. `ReaderWorkspace.svelte` contains none of them (panes are fixed `flex: 1`). Either implement or re-open the roadmap items. *(Roadmap has been corrected to reflect reality — the items are re-opened.)*

### 14. Pane 0 is special-cased; navigation logic exists twice and has diverged
The primary pane uses workspace-local `$state` while extra panes use `PaneState`. The two `loadChapter` copies already behave differently (workspace falls forward *and* backward through empty chapters; `PaneState` only falls forward). Unify pane 0 onto `PaneState` and delete the duplicate. Also part of decomposing the 1,100+-line `ReaderWorkspace`.

### 15. Assorted
- `restoreExtraPaneLocations(defaultTranslation)` ignores its parameter (`splitPanes.svelte.ts:187`).
- `navHistory` writes a non-`UserPreferences` record into the typed `settings` table via `as any` — move to its own key/value store or a dedicated table before v0.8.0 export enumerates "all user data."
- Persistence is scattered across three mechanisms (preferences in Dexie, split panes in `localStorage`, nav history in the Dexie settings table). Consolidate on Dexie.
- `navigateToAnnotation` doesn't `visitCurrent()` before navigating while `navigateToVerse` does — inconsistent breadcrumb behavior.

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
