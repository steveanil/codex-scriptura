# Feature Inventory

Everything Codex Scriptura can do today, from a full codebase audit (2026-08-19). This is the source of truth for "what exists" - for the maintainer first, and as the base for future in-app help.

> **Maintenance rule:** a PR that adds, removes, or meaningfully changes a user-facing feature updates this file in the same PR. Stubs and gaps are listed at the bottom so they are not mistaken for features.

## The app in one paragraph

An offline-first Bible study PWA. First boot seeds the starter translation (KJV) plus the shared datasets - 299K cross-references, 6,100+ people, 2,500+ places, 900 events, a 14K-entry Strong's lexicon, Nave's topical index, and a genealogy graph - into IndexedDB; six more public-domain translations download on demand from Settings. Everything works fully offline once downloaded. The four surfaces are the reader (`/read`), search (`/search`), graph (`/graph`), and theme threads (`/themes`), plus a global command palette.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+K` | Open/close the command palette (global) |
| `Cmd/Ctrl+\` | Toggle split view (open a pane / close all extras) |
| `Cmd/Ctrl+Shift+P` | Toggle the scratch pad |
| `Alt+Left` | Navigate back through chapter history |
| `Alt+M` | Cycle the search mode (on `/search`) |
| `Left/Right` on a segmented control | Move the choice (Settings, search mode, testament filter) |
| `Shift+click` verse | Select a contiguous verse range |
| `Esc` | Close palette / popovers / genealogy modal / clear ring selection |
| `Up/Down`, `Enter` | Navigate and open palette results |

Settings > Keyboard shortcuts lists these read-only (it renders `src/lib/shortcuts.ts`); hints also appear inline (split toolbar, scratch pad footer, palette footer).

---

## Reader (`/read`)

Primary components: `ReaderWorkspace.svelte`, `ReaderPane.svelte`, `PaneState` in `stores/splitPanes.svelte.ts`.

### Navigation

- **Passage picker** - one book-and-chapter trigger opens a keyboard-driven picker: type a book to filter (grouped OT / NT / Apocrypha, partial-translation books greyed with a tooltip and a coverage note) or a reference like `Ps 23` or `John 3:16`; arrows move the highlight, Enter goes, Escape closes; a chapter grid follows the highlighted book; the header shows the current location and its reading-time estimate.
- **Chapter navigation** - prev/next chevrons (roll over book boundaries) in the Locate zone; a chapter-pill strip appears only for books of 25 chapters or fewer when it fits the bar (mouse wheel scrolls it; active pill auto-centers), otherwise the trigger is the chapter control.
- **Layers menu** (View zone) - Entities (underline people, places and events in the text; click one to open its rail tab), Red letter, Cross-references, Verse numbers.
- **Translation picker** - per pane, listing downloaded translations only; "(partial)" label and tooltip for in-progress translations; the rest of the catalog downloads from Settings > Translations; switching falls back to the nearest valid book/chapter, and empty chapters silently walk to the nearest non-empty one.
- **Reading-time estimate** - "~N min" per chapter from the reading-speed preference, shown in the passage picker header.
- **URL sync and deep links** - `?book=&chapter=` always reflects the location (replaceState); `#verse-N` scrolls and flashes a verse; with no params the reader resumes the last-read location.
- **Navigation history** - breadcrumb trail (up to 6 chips) at the bottom with a Back button (`Alt+Left`, 20-entry stack); restores scroll position; persists across sessions in the `kv` table.
- **Page title sync** - browser tab shows "Book Chapter - Codex Scriptura".

### Split view and translation comparison

- **Up to 3 panes** (`Cmd/Ctrl+\` or the split button), each fully independent (own book/chapter/translation and header controls); a room guard disables the button below 280px per pane; layout, weights, and toggles persist across sessions.
- **Draggable dividers** trade width between panes (double-click to equalize); panes stack vertically on mobile.
- **Sync scroll** - toggle; verse-anchored when panes share a chapter, proportional otherwise.
- **Cross-pane linked hover** - hovering a verse softly highlights the same verse in the other panes.
- **Divergence shading** - when two panes show the same chapter in different translations, differing words get an accent tint; clicking a shaded word opens a popover comparing every translation's rendering, with the underlying lemma and a "Word Study" link when word alignment covers it.
- **Divergence Map** - a side panel listing every verse where the compared translations meaningfully disagree, sorted by severity; clicking a card flashes the verse in all panes.
- **Refs toggle** - hides/shows all inline cross-reference and quotation badges while split.
- Sidebar auto-collapses to an icon rail while split.

### Verse display

- Verse numbers (toggleable), verse-range display for bridged verses, prose (the default) vs verse-per-line layout (split view always renders verse-per-line so lines align across panes), note indicator on annotated verse numbers, highlight tinting (translation-scoped), 1.6s flash on every jump-to-verse.
- **Words of Jesus** in red (WEB only; preference-gated).
- **Entity marks** - person/place/event names become colored marks with the Entities layer on, or while a Who's here or entity tab is in front on the Study Rail.
- Live-applied preferences: scripture font, size, line spacing and column width (the `--scripture-size/leading/measure` family; the interface type scale is separate), accent color, theme. Density changes list row heights, never the scripture column.

### Selection and annotation

- **Select verses** by click (toggle) or Shift+click (range); a floating toolbar appears with:
  - **Highlight swatches** (from your custom presets) - one annotation per contiguous run; eraser removes covering highlights in that pane's translation.
  - **Note** - opens the annotation sidebar's editor anchored to the selection, with tags.
  - **Theme** - tags the selection into a named theme thread (autocomplete from existing themes, duplicate-safe).
  - **Copy** - plain verse text to the clipboard.
  - **Scratch** - quotes the selection into the scratch pad with attribution.
  - **Graph** - jumps to the neighborhood graph seeded on the first selected verse.
- **Annotation sidebar** ("Annotations" under Study in the sidebar, or the Note button; on phones from the reader only) - two tabs: This Chapter and All Annotations (live-updating across books and tabs), grouped into Notes / Highlights / Themes, with jump-to-verse (hover shows a preview card) and delete on every entry. Note editor supports creating tags.

### Study Rail: entities, word lookup, lineage, maps

- **Study Rail** (rail button in the header, per pane; on phones a bottom sheet with a peek and a full stop, drag or tap the grip) - one tabbed right-hand column for every side panel: up to four tabs stay resident (least recently used is evicted), tabs survive chapter changes, the strip shows count badges, arrow keys switch tabs, the header has a kind icon, title, qualifier, an overflow menu (close others / close all / hide and keep tabs) and close. Drag the left edge to resize (320 to 520px, persisted). Opened with nothing in it, the rail lists what it can show and how to get there.
- **Who's here** tab - collapsible People / Places / Events lists for the chapter, with avatars, location-confidence badges, and counts; follows the chapter.
- **Entity tabs** - one per person/place/event: name meaning, Easton's entry, verse pills, Family tree and View-in-graph buttons; place: coordinates, confidence badge, an embedded OpenStreetMap Leaflet map (offline-aware fallback); event: formatted year (BC/AD). Clicking the entity whose tab is in front closes it.
- **Double-click a word** - lookup cascade: chapter person > place > event > Easton's dictionary > "no definition" fallback, each opening a rail tab; every card offers "Search word in Bible".
- **Verse hover previews** - hovering any verse reference (cross-ref pills, dictionary refs, entity pills, sidebar refs) shows the verse text in a floating card after a short dwell; clicking it navigates.

### Cross-references and quotations

- **Inline badge** per verse with the cross-reference count (the Cross-references layer, off by default for fresh profiles; Layers menu or Settings); click expands a pill row under the verse (first 5, "+N more"), each pill navigating with flash and hover preview, plus a link into the graph. The badge itself has no hover behaviour.
- **Quotation badge** on verses quoting earlier scripture; its row offers "Open in split pane" to view the quoted source side by side.

### Lineage and genealogy

- **Lineage tab** - in Genesis, Table-of-Nations names are always tappable and open a descendant tree on the Study Rail (re-rootable, breadcrumb, home-to-Noah; the tab's qualifier names the seed verse), escalating via "Open in full tree".
- **Genealogy tree modal** (global) - full family tree over ~1,700 people: generational layout, 1-3 generation slider, re-center by clicking any card, ancestry breadcrumb, Father's/Mother's line toggle when both parents are recorded (e.g. Jesus via Joseph vs Heli), branch color legend, reset.

### Scratch pad

- Persistent free-text pad (`Cmd/Ctrl+Shift+P`); survives reloads.
- Receives verse quotes from the selection toolbar or by **dragging a verse number** into it (drags also carry plain text for external apps).
- **Convert to note** promotes pad text into a real annotation, auto-anchored to the verse references it contains; non-destructive.
- Clear (with confirm) and close.

---

## Search (`/search`)

Three modes (a segmented control; `Alt+M` cycles it), live-as-you-type, with a testament filter (All/OT/NT/AP, segmented), multi-translation selection, saved searches (star to save; pills to re-run/delete), match highlighting, and deep links (`?q=`, `?mode=`, `?topic=`).

### Full Text

- MiniSearch across selected translations: prefix matching, typo-fuzzy for longer terms, stop-word removal, exact-phrase boosting, top 50 results.
- Strong's numbers work here too on tagged translations.
- Indexes are built client-side, cached in IndexedDB, and invalidated on re-seed.

### Word Study (concordance)

- **Word queries** - exhaustive whole-word scan in canonical order (uncapped), with an optional "Match word variants" stemmer (loved/loves/loveth...), apostrophe-insensitive matching, per-verse hit counts.
- **Lemma grouping** (the flagship) - with a word-aligned translation selected, English occurrences group by the underlying Hebrew/Greek lemma ("love" splits into agapao, phileo, ahab...), each group headed by its lexicon entry, surface-form counts, expandable verse lists, and "Every HNNNN occurrence, all renderings".
- **Strong's queries** (`H7225`, `g26`) - full concordance across tagged translations with a lexicon header card; falls back to all tagged translations with an explanatory note if yours aren't tagged.
- **"From the lexicon"** - gloss/lemma/transliteration matches (diacritic-folded) surface below results, expandable, with "See every occurrence".

### Topics

- Nave's Topical Bible: ranked topic-name search over 5,320 topics; topic detail with sections, reference chips into the reader, and See-also links between topics.

### Query cheat sheet

`bread of life` (phrase-boosted full text) · `kingd` (prefix) · `H430` / `g0026` (Strong's) · `love` + variants toggle (concordance) · `agape` / `elohim` (lexicon) · `forgiveness` (topics) · `John 3:16` / `1 Cor 13:4-7` / `Gen.1.1` (palette reference jump).

---

## Command palette (`Cmd/Ctrl+K`)

- **Reference jump** - any book/chapter/verse reference format, including abbreviations and OSIS ids.
- **Book jump** - prefix match on names/abbreviations, labeled by testament.
- **Verse text search** - top 5 verses from the active translation (index cached, rebuilt on translation change).
- **Note search** - top 3 of your notes by substring.
- Grouped results, full keyboard navigation, mouse hover-select, Esc/backdrop close, empty-state hint.
- Note: despite the name, it currently has no app *commands* (no actions like toggling theme or opening settings).

---

## Graph (`/graph`)

### Canon ring (overview)

- All 66 books on a circle in 8 canonical sections; node size = chapter count; testament coloring.
- Edges are book-to-book cross-reference weights (TSK-derived): warm = cross-testament, cool = same-testament. Default view draws no edges; "Show all links" draws the strongest 300; clicking a book shows only its edges and a detail panel (degree, chapters, top-7 strongest links, all clickable).
- "Most connected" hub list when nothing is selected; search box jumps to a book or (with a verse ref) into neighborhood mode; `?book=` deep link; Esc or background click clears.

### Neighborhood graph (focus)

- BFS neighborhood seeded from a verse (`?verse=`, reader Graph button, ring search) or an entity (`?person=/place=/event=` via "View in graph").
- 1 or 2 hop depth toggle, 120-node cap, concentric-ring layout, entity nodes as terminal leaves, solid edges = cross-references, dashed = entity mentions, legend.
- Click to inspect (detail panel with stats), click again to re-center the graph there, "Open in reader" for verses, "Books" chip back to the ring.

---

## Themes (`/themes`)

User-authored topical threads (created from the reader's Theme button, not preset content).

- Index of all themes as cards with passage counts; teaching empty state.
- Thread view (`?t=slug`): every tagged passage in canonical order with verse text from the active translation, book dividers, "Read in context" links, and per-passage removal.
- Not reachable from the mobile bottom nav (only via theme pills and URLs).

---

## Settings (`/settings`)

Auto-saved. A sticky section rail on the left (scroll-spied; a chip row on phones) jumps between raised cards, each opening with a mono kicker:

- **Appearance** - theme (Light/Dark/System); accent: six preset swatches, a hex field with a native picker, live AA contrast readouts against both theme backgrounds, and "Darken for light theme", which stores a second hue used only while the light theme is resolved (one stored hue per theme); scripture font, interface font, Greek and Hebrew fonts (system fallback when not installed).
- **Reader** - a live specimen (the first verses of the active translation, drawn with the reader's own tokens) above the controls: translation (the reader's active one), open at launch (last read or a fixed passage), column width, scripture size, line spacing, density (row height of lists and panels), verse numbers, reading speed, paragraph mode (Prose default; split view is always verse-per-line), red letter (red, WEB; the row explains itself and links to the Library when WEB is not installed), cross-references, divergence shading, synced scrolling (the last three mirror the reader's toggles).
- **Highlights** - add/rename/recolor/delete the highlight swatches (min 1).
- **Library** - every corpus the app can download, filtered by All / Translations / Manuscripts / Lexicons / Church Fathers / Installed with counts. Translations come from the catalog with tagging/coverage/license notes, verse counts, download progress, Retry on failure, and Remove (guarded: never the last installed translation or the reader's active one). Manuscripts, lexicons and Church Fathers are empty categories that name the milestone that fills them (v0.5.0 for the first two, v0.6.0 for the Fathers, which arrive as a resource).
- **Data** - export a backup (annotations, tags, saved searches, settings as one JSON file; the count and last-export date are shown, and the rail shows a dot on Data while annotations exist with no backup ever written); import a backup (summary first, then Merge or Replace); persistent-storage status and request; reset settings to defaults (annotations and corpora untouched).
- **Keyboard shortcuts** - read-only list of the shortcuts that exist (`src/lib/shortcuts.ts`).
- **Plugins** - empty state; resource packs arrive with v0.6.0 and executable plugins with v1.1.0.
- **Storage** - what the browser reports for the app, then per-item bars measured from the records: each installed translation (approximate, Remove), annotations (exact, Export), search index (exact, Rebuild), entity graph (approximate).
- **About** - latest update + What's New button; Send feedback (pre-filled mailto).

---

## Offline, PWA, and boot

- Installable PWA (standalone display); everything except place-map tiles works offline once seeded/downloaded.
- Service worker precaches the app shell only (seed data is fetched once into IndexedDB, never cached); navigations are network-first with an offline shell fallback; deploys take effect immediately.
- Boot: weighted progress bar with per-dataset steps, first-run hint, multi-tab upgrade notice, fatal-error card with retry.
- Seeding is per-dataset isolated: one failure shows a dismissible banner (with Retry) instead of blocking boot, and retries next launch.
- **What's New** - auto-opens once after an update (silent on true first run), sidebar badge until seen, last 5 entries, reopenable from the sidebar or Settings.

---

## Data shipped

| Translation | License | Strong's | Word-aligned | Notes |
|---|---|---|---|---|
| KJV (1769, with Apocrypha) | Public domain | yes | yes | |
| WEB | Public domain | yes (derived) | no | Only translation with words-of-Jesus spans |
| BSB | Public domain (2023) | yes | yes | |
| ASV (1901) | Public domain | yes | yes | |
| DBY (1890) | Public domain | yes | yes | |
| YLT (1898) | Public domain | no | no | |
| OEB | Public domain | no | no | NT + partial OT |

Datasets (verified counts): 298,542 cross-references (typed, TSK/OpenBible, one record per verse pair), 6,138 persons, 2,548 places (geocoded with confidence), 900 events, 3,962 Easton's dictionary entries, 4,479 genealogy relationships, 14,197 lexicon entries (8,674 Hebrew + 5,523 Greek), 5,320 Nave's topics. Total seed payload ~148MB.

---

## Known gaps and stubs (audited 2026-09-16)

Things a reader of this document might assume exist but do not. Kept here so they inform roadmap decisions instead of surprising users.

- **Backup is whole-file only** - Settings > Data exports and imports one JSON backup (merge or replace); there is no granular clear (all highlights / notes / themes) and no per-book or per-type export (#277). Sync between devices is v0.8.0.
- **No annotation editing** - cards are delete-and-recreate only (deletes are undoable from a toast).
- **No tag management** - tags can be created on notes but never listed, filtered by, renamed, recolored, or deleted; stored tag colors are never shown.
- **Bookmark and memorization** annotation types exist in the data model with zero UI.
- **Command palette has no commands** - navigation and search only; no action execution, no `>` syntax.
- **No keyboard navigation of search-page results** (palette only).
- **No pan/zoom** on the canon ring, neighborhood graph, or genealogy tree (scroll container only); no search within the genealogy tree.
- **No share action** - clipboard copy only (verse text with its reference); no share sheet or link.
- **Theme threads** cannot be renamed, merged, or deleted whole; themed verses have no inline marker in the reader.
- **No credits/attribution screen** - each translation's license shows on its Library row, but there is no consolidated page crediting texts and datasets (#235).
- **Entity marks are a reader-only layer** (Layers menu); Settings carries the cross-reference, divergence and sync toggles but not that one. "System" theme does not react live to OS changes (applies on reload).
- **No reduced-motion support beyond the button spinner, no focus traps, no skip links**; modals close on Esc but don't restore focus.
- **Red letter knows one translation** - the Settings row and the Library meta special-case WEB instead of reading a capability from the catalog (#349); the shortcut list is hand-maintained rather than a registry (#350).
- **Library categories are placeholders** - Manuscripts and Lexicons show as empty categories naming v0.5.0, Church Fathers names v0.6.0; the category list is the old corpus split, not the resource types the v0.6.0 Resource Manager will list (D2, D12). Plugins is an empty state until v0.6.0 / v1.1.0.
- Dead code: `toggleTheme()` in the layout, `getChapterConnections()` graph engine ("mid zoom" level).
- PWA: no custom install prompt.
