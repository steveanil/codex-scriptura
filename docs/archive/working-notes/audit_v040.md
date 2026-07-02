# Codex Scriptura v0.4.0 Implementation Audit

> Audit Date: 2026-04-01 | Auditor: Antigravity | Method: Static code analysis + data file inspection

---

## 1. Roadmap Coverage Table

| Item | Feature | Status | Evidence | Missing |
|------|---------|--------|----------|---------|
| **1A** | Cross-reference schema & importer | **COMPLETE** | `importers/import-cross-references.ts`, `CrossReference` type in `core/types.ts`, Dexie v9 schema; `static/data/cross-references.json` = 341,267 records | — |
| **1B** | `import-theographic-relationships.ts` (genealogy) | **COMPLETE** | `importers/import-genealogy.ts` — parses CSV, maps relationship types; `genealogy.json` = 2,590 records seeded | No real relationship CSV source exists — importer silently emits `[]` if the file is missing and treats that as OK |
| **1C** | BibleData HebrewStrongs import | **COMPLETE** | `importers/import-hebrew-strongs.ts`; `lexicon-hebrew.json` = 8,674 entries; `LexiconEntry` type in core | Greek lexicon explicitly deferred (BibleData has no GreekStrongs.csv); `lexicon-greek.json` does not exist |
| **1D** | Strong's-tagged OSIS verse source | **NOT STARTED** | `VerseRecord.lemmas` field exists; `getStrongsForVerse()` in `db/src/index.ts` explicitly returns `[]` with a comment "deferred to v0.5.0" | Blocker: no tagged OSIS source acquired; no importer for verse→lemma mapping |
| **3A** | Verse neighborhood BFS engine | **COMPLETE** | `src/lib/engines/graph.ts` — `getNeighborhood()`, `expandVerseNode()`, 120-node cap, filter support, `BookConnectionMatrix` | Engine is Phase-3 only: non-verse starting nodes (`person:`, `place:`, `event:`) return `{ nodes: [], edges: [], truncated: false }` |
| **3B** | Genealogy BFS engine | **COMPLETE** | `src/lib/engines/genealogy.ts` — `buildPersonSubgraph()`, depth cap 4, node cap 120, warning at 80, bidirectional traversal, edge deduplication | — |
| **3C** | Book-level density matrix | **COMPLETE** | `getBookCrossReferenceMatrix()` in both `db/src/index.ts` (DB layer) and `engines/graph.ts` (session-cached wrapper) | — |
| **4A** | Verse hover preview | **PARTIAL** | `VersePreviewCard.svelte`, `verseHover.ts` action, `ui.svelte.ts` state — fully implemented. Wired in: `AnnotationSidebar` (4 sites), `EntityDetailPanel` (3 sites). **NOT wired in `ReaderPane.svelte`** — no `use:verseHover` exists in the verse text renderer | No inline cross-reference markers in verse text; hover only works from sidebar and entity panels, not from scripture text |
| **4B** | Graph View (zoomable scripture graph) | **NOT STARTED** | No route, no D3/renderer, no `GraphView` component present anywhere in `src/` | Engines exist but have zero UI surface |
| **4C** | Interactive Genealogy Viewer | **NOT STARTED** | No route `/study/person/:id`, no D3/force component, no genealogy viewer UI anywhere in `src/` | Engines exist but have zero UI surface |
| **4D** | Split view | **PARTIAL** | `splitPanes.svelte.ts` (`PaneState` class, localStorage persistence), wired into `ReaderWorkspace.svelte` (`addPane`, `removePane`, `extraPanes`, per-pane nav headers). Working: add pane, close pane, independent navigation, translation switching, session restore | Missing from roadmap spec: sync-scroll toggle, draggable dividers (flex-basis is fixed, not draggable), minimum-width enforcement missing, `Cmd+\` shortcut not wired in this file |
| **4E** | "Why is this quoted?" OT badge | **NOT STARTED** | No inline badge component, no quotation-type filter applied anywhere, cross-references are all `type: 'unclassified'` (importer assigns this universally — no classification logic) | The `'quotation'` edge type exists in the schema but every record imported is `'unclassified'` |
| **4F** | Theme threading (`/study/theme/:slug`) | **NOT STARTED** | No route, no component, no annotation subtype `'theme'` in the codebase | — |
| **4G** | Scratch pad | **NOT STARTED** | No component, no `Cmd+Shift+P` handler | — |
| **4H** | Strong's Concordance integration | **NOT STARTED** | `ConcordanceSearchMode: 'lexical'` type exists; `searchLexicon()` in DB exists; Hebrew lexicon seeded — but zero UI connects to it | Blocked by 1D (verse→lemma mapping). `getStrongsForVerse()` is a tombstone that returns `[]`. |
| **4I** | Lexicon lookups (Strong's → gloss) | **NOT STARTED** | `getLexiconEntry()`, `searchLexicon()` in DB all exist; 8,674 Hebrew entries in Dexie — but no UI component displays them | Zero UI wires to `lexicon` table |
| **4J** | Semantic/topical search | **NOT STARTED** | Not present | — |
| **4K** | Maps (place lat/lng → Leaflet/MapLibre) | **NOT STARTED** | `Place.lat`, `Place.lng`, `Place.confidence` all populated in `places.json`; no map library installed, no map component | Data ready; zero rendering |

---

## 2. Reality Check

### Features Marked "Complete" But Are Actually Partial

**Verse Hover Preview (4A) — Claimed `[x]` in roadmap**

The roadmap claims this is done and marks it with a checkbox. What actually exists:
- `VersePreviewCard.svelte`: complete, well-implemented
- `verseHover.ts` action: correct debounce logic, works
- Wired into `AnnotationSidebar` and `EntityDetailPanel` — works in those contexts

**What's missing:** The primary use case in the roadmap spec — *"in cross-reference markers"* — does not exist. There are **no inline cross-reference markers in verse text**. `ReaderPane.svelte` does not import or use `verseHover` at all. The vision was Wikipedia-style hover on scripture references embedded in the text; what shipped is hover on verse references in the annotation sidebar and entity panels. That's a fraction of the claimed feature.

**Genealogy Data (1B) — "Complete"**

`genealogy.json` contains 2,590 records. However: the importer expects a CSV at `data/texts/bibledata/BibleData-Relationship.csv` or similar, and **if that file doesn't exist, it silently writes an empty array** and logs a warning. This is a graceful degradation pattern but it means "complete" hinges on a file that was never documented as fetched by `pnpm setup:data`. The `pnpm setup` script in `data-pipeline/package.json` runs `import:genealogy` without a preceding `fetch` step — meaning on a fresh clone the genealogy JSON is produced from... nothing.

**Cross-references (1A) — "Complete"**

The data and schema are genuinely complete (341,267 records). However, all records have `type: 'unclassified'` — the importer hardcodes this:
```typescript
type: 'unclassified',  // line 100, import-cross-references.ts
```
The entire cross-reference type system (`quotation`, `allusion`, `theme`, `keyword`, `parallel`) is dead. Every downstream feature that depends on edge types — the "Why is this quoted?" badge (4E), type-filtered graph views — has no classified data to work with.

### Hidden Gaps (Data Exists, Not Connected to UI)

| Data | UI Consumer | Gap |
|------|------------|-----|
| `crossReferences` table (341,267 rows) | Nothing in any Svelte component | The entire cross-reference dataset is seeded into Dexie but **no Svelte component queries or renders it** |
| `relationships` table (2,590 rows) | Nothing in any Svelte component | `buildPersonSubgraph()` is never called from any component |
| `lexicon` table (8,674 Hebrew entries) | Nothing in any Svelte component | `getLexiconEntry()` / `searchLexicon()` are never called from any component |
| `getNeighborhood()` engine | No component | Complete BFS engine with no render target |
| `getBookCrossReferenceMatrix()` | No component | Full 340K-row scan capability with no zoom-out graph view |
| `Place.lat` / `Place.lng` | No map component | GPS coordinates exist in `places.json` for most places; zero map rendering |

**Total: 3 Dexie tables and 3 engine functions are completely invisible to the user.**

### Dead Code / Unused Infrastructure

- **`getStrongsForVerse()`** (`db/src/index.ts:681`) — declared, documented, permanently returns `[]`. This is a documented stub masquerading as a function.
- **`ConcordanceSearchMode: 'lexical'`** (`core/types.ts:138`) — the type exists; `SavedSearch.mode` can hold it; the search UI in `/search/+page.svelte` may show a mode selector — but calling it invokes nothing different from `concordance` mode since there's no data.
- **`GraphEdgeCategory: 'genealogy'`** — used in `genealogy.ts` as `category: 'genealogy'` on edges, but no renderer distinguishes this from other edge categories.
- **`NeighborhoodResult.totalAvailable`** — documented as "reserved for a future pass", never populated.
- **`ReaderOptions.layout: 'parallel'`** — the `parallel` layout mode exists in the type but the roadmap says parallel translation is a sub-mode of split view, not a separate render mode. No code path activates it distinctly from `'single'`.

### Fragile / Implicit Implementations

**Cross-reference seeding — 340K row IndexedDB transaction**

`seedCrossReferences()` fetches `cross-references.json` (38 MB), parses it, then `bulkPut`s in 10K-row batches inside a Dexie transaction. On a slow device or low-spec browser, this will block for several seconds and has no progress indicator. Silent failure is handled but there's no user feedback if it fails.

**Genealogy data gap**

The relationship importer has a "graceful degradation" path that emits an empty JSON file when the CSV source is missing. This means a contributor running `pnpm setup` will get a seeded `genealogy.json` containing `[]`, `isRelationshipsSeeded()` will return `false` (correctly — 0 records), and `seedRelationships()` will log "structurally intact but empty. Skipping tx." — which could be mistaken for a successful seed. The genealogy.json in `static/data/` currently has 2,590 records, meaning someone ran a valid importer at some point, but the fetch step to obtain the CSV is not in any publicly visible `pnpm setup:data` pipeline script.

**Split pane — no minimum width enforcement**

The roadmap specifies "Minimum pane width: 280 px (disables '+ Add pane' when reached)." The `addPane()` function only checks `extraPanes.length >= 2` — no window width check. On a 640px screen, adding 3 panes generates ~213px-wide panes, rendering them unreadable.

**VersePreviewCard positioning bug risk**

The card uses `position: fixed` with `top` and `left` calculated after a `requestAnimationFrame`. If the popover's `getBoundingClientRect()` returns zeros (rendered but not painted), `calcTop` is negative and the card jumps below the element. This is a known race condition with `display:none` → display transitions.

---

## 3. Quality Assessment

### Architectural Consistency

**Good:** Core/DB/UI separation is solid. `@codex-scriptura/core` holds types and pure functions; `@codex-scriptura/db` holds all Dexie queries; `src/lib/engines/` holds BFS algorithms that import from both; components are consumers. The separation is clean and correct.

**Problem:** The graph engines (`graph.ts`, `genealogy.ts`) live in `src/lib/engines/` (app layer) rather than in `packages/core`. The roadmap says the engines are "core infrastructure"; placing them in the app layer means they can't be used by the plugin API or bundled into `@codex-scriptura/core`. This is a premature architectural violation.

**Problem:** `PaneState` (in `splitPanes.svelte.ts`) duplicates the data loading logic that already exists in `ReaderWorkspace.svelte`. Both have `loadChapter()`, `loadNavigation()`, `nextChapter()`, `prevChapter()` — one as class methods, one as module-level functions. This is a mild but real divergence that will drift further.

### Separation of Concerns

**Good:** `seed.ts` correctly handles all data initialization in one place. `ui.svelte.ts` is appropriately minimal (hover preview state + sidebar flag only).

**Problem:** `ReaderWorkspace.svelte` is 1,128 lines and manages: navigation history, annotation CRUD, split pane state, preferences reactivity, URL sync, keyboard shortcuts, and component orchestration. It's doing too much and will become unmaintainable when the genealogy viewer and graph view land there too.

### Scalability Risks

**Cross-reference seeding (38 MB):** Loading 38 MB JSON → parsing → 34 batched IndexedDB writes is acceptable once; but the app has no mechanism to detect a stale seed (e.g., after a data pipeline update). `isCrossReferencesSeeded()` returns true if any rows exist, making forced re-seed impossible without clearing the DB manually.

**`getBookCrossReferenceMatrix()` — full 340K row scan:** The session-level cache in `graph.ts` is correct, but the first call iterates all 340K records. On a slow device this will freeze the renderer thread if called synchronously in a Svelte `$effect`. No Web Worker offloading exists (the roadmap defers this to v0.9.0).

**MiniSearch still on main thread:** The `/search` page (and command palette) rebuild or load serialized MiniSearch indexes on the main thread. The cache (v0.3.1 feature) mitigates this on repeat visits, but a first visit with a slow device will jank visibly.

---

## 4. What Actually Delivers User Value

### Genuinely Visible and Useful

- **Bible reader** — 3 translations (KJV, OEB, WEB), chapter navigation, verse numbers, red letters (WEB only), paragraph mode
- **Highlights and notes** — multi-color, per-verse, persistent
- **"Who's Here?" entity panel** — persons/places/events per chapter, inline underline highlighting, detail cards
- **Easton's dictionary** — inline definitions in entity panels
- **Name meanings** — Hebrew/Greek etymology in person cards
- **Full-text and concordance search** (`/search`) — ranked + exhaustive word scan
- **Command palette** (Cmd+K) — instant search + navigation
- **Split view** — add up to 2 extra panes, independent navigation, different translations, session-persisted
- **Verse hover preview** — appears in annotation sidebar and entity detail panels
- **Navigation history breadcrumb** — trail with back navigation (Alt+←)
- **Settings** — theme, fonts, reading speed, accent color, highlight presets, red letters, paragraph mode

### Feature Exists But Is Invisible to the User

- **341,267 cross-references in Dexie** — no UI surface whatsoever
- **2,590 genealogy relationships in Dexie** — no UI surface
- **8,674 Hebrew lexicon entries in Dexie** — no UI surface
- **Place GPS coordinates (`lat`/`lng`)** — no map renders them
- **Graph neighborhood engine** — runs in zero production code paths
- **Genealogy BFS engine** — runs in zero production code paths
- **Book cross-reference density matrix** — never computed for the user

---

## 5. Highest-Leverage Next Steps

### Priority 1: Surface Cross-References in the Reader (Visible Impact, Existing Data)

**What:** Add inline cross-reference markers to verse text in `ReaderPane.svelte`. For each displayed verse, load its cross-references from Dexie (using `getCrossReferencesFrom`, already exists) and render small superscript tags. Wire `use:verseHover` to each tag.

**Why this first:** You have 341,267 cross-references seeded and ready. You have `VersePreviewCard` already working. You have `getCrossReferencesFrom()` already written. All three pieces are built — they just aren't connected. This is the single change that makes the largest invisible dataset immediately visible, and it directly completes the most high-value piece of the "Deep Study" milestone. Expected effort: 1–2 days. The verse hover preview will feel "complete" instead of "partial."

**Specific implementation:** In `ReaderPane`, after chapter load, call `getCrossReferencesFrom(verse.osisId)` for visible verses (lazy-load or batch), append `<sup class="xref-marker" use:verseHover={{ osisId: ref.targetVerse, translationId }}>†</sup>` after each verse text.

---

### Priority 2: Build the Genealogy Viewer UI (High Value, All Engines Ready)

**What:** Create a `GenealogyViewer.svelte` component and wire it into `EntityDetailPanel` as a contextual mini-graph (entry point: "Who's Here?" → person). Use D3 force simulation — the engine produces `GraphNode[]` and `GraphEdge[]` already in the correct shape.

**Why this second:** `buildPersonSubgraph()` is implemented, tested, capped, and data is seeded. This is the only v0.4.0 "killer feature" (Matthew 1 + Luke 3 side by side with genealogy) and it currently delivers zero user value. The contextual mini-graph entry point (from EntityDetailPanel, no new route needed) is lower effort than the standalone route and provides immediate value in the reading context.

**Specific implementation:** Add a D3 dependency. In `EntityDetailPanel`, when showing a person, call `buildPersonSubgraph(person.id, 2)` and render the result as a force-layout SVG inside the panel. Depth slider (1–4) already specified in roadmap. Node cap warning already implemented in the engine. Estimated effort: 3–4 days (D3 setup + styling).

---

### Priority 3: Classify Cross-Reference Edge Types (Data Quality, Unblocks Downstream)

**What:** Replace the `type: 'unclassified'` hardcode in `import-cross-references.ts` with heuristic classification. The OpenBible dataset doesn't provide types, but you can implement deterministic rules:
- OT source → NT target: classify as `'quotation'` if votes > 50, `'allusion'` otherwise
- Same-book: `'parallel'`
- Everything else: `'theme'` if votes > 30, `'keyword'` if votes > 10, `'unclassified'` otherwise

**Why this third:** Every downstream feature — "Why is this quoted?" badge (4E), type-filtered graph views, the `edgeTypes` filter in `getNeighborhood()` — depends on classified edge data. Currently the filter parameter is a no-op because every edge is `'unclassified'`. This requires re-running the importer and re-seeding, but it's entirely a data pipeline change with no UI work. Estimated effort: 2–3 hours in the importer + pipeline rerun.

---

## Appendix: Pipeline Script Gap

The `import:genealogy` script in `data-pipeline/package.json` has no corresponding `fetch:genealogy` step. The composite `pnpm run setup` script includes `import:genealogy` but the CSV source (`BibleData-Relationship.csv` or `Theographic People_Relationships.csv`) has no documented fetch target. The existing `genealogy.json` was produced by a developer manually running the importer against a local file. **A fresh contributor clone cannot reproduce the genealogy dataset** — `pnpm setup` will silently produce an empty `genealogy.json`.
