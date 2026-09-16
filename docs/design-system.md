# Design System

The rules the interface is built from. Tokens live in `src/app.css`; this
document says what each family means and how to choose from it. Findings
come from the UI/UX design audit of 2026-08-19 (the audit itself lives in
the Codex Scriptura Design System project on claude.ai/design); the v0.4.2
milestone turned them into the rules below.

Two governing habits:

- **A component never invents a value.** Colour, size, radius, row height,
  elevation and typography come from a token family. If the family lacks
  what you need, extend the family in `app.css` and write down the rule.
- **The scripture column is the protagonist.** Everything else (chrome,
  panels, markers) is quieter than the text it serves.

## Colour

- `--color-bg` / `--color-bg-deep` / `--color-bg-elevated` are the three
  opaque page backgrounds. `--color-bg-surface` and `--color-bg-control`
  are opaque resting surfaces for cards and controls.
- `--color-bg-hover` is the only translucent wash, and it is for hover
  states only. Never use it as a resting background: over anything but the
  page it goes see-through.
- Text is a three-step ramp: `--color-text-primary`, `-secondary`,
  `-muted`. Muted is the floor for any text, including 12px captions.
- `--color-border` is a decorative hairline; `--color-border-control` is
  the boundary of anything interactive (3:1 against the page).
- The accent means "interactive or selected" and nothing else.
  `--color-mark` is the one attention colour (search hit, jump flash,
  lineage seed). Categorical colour comes from the `--cat-*` pool.

## Elevation

Three steps and no others:

| Step | Recipe | Used for |
|---|---|---|
| flat | `--color-bg`, no border, no shadow | the page |
| raised | `--color-bg-elevated` + 1px `--color-border` hairline, no shadow | panels, bars, cards, rails, the sidebar |
| floating | `--color-bg-elevated` + `--shadow-floating`; `--color-scrim` behind anything modal | popovers, menus, modals, drawers, toasts, sheets |

`--shadow-sm` and `--shadow-md` remain for the two in-between uses that
already exist (card hover lift, the divergence map). Nothing new picks them.

## Row heights and density

Every list-like surface declares exactly one row height from
`--row-h-sm` (32px), `--row-h-md` (40px) or `--row-h-lg` (48px):

| Surface | Height |
|---|---|
| Sidebar nav items, palette results, entity rows, lineage rows, settings rows | md |
| Graph link rows, topic rows | lg |
| Dense metadata rows (future: cross-reference lists in a rail) | sm |

The Settings **Density** control shifts the whole set one step
(`data-density="compact"` or `"relaxed"` on `<html>`); it does not touch the
scripture column, whose rhythm is its own leading. Devotional surfaces
(Story Mode, reading plans) opt out by redeclaring the three tokens at their
base values on their own root.

## Typography

Two scales that never move together:

- **UI scale**: `--font-size-2xs` (11px, the floor and the single legal size
  for mono metadata) through `xs`, `sm`, `md` (15px, section headings),
  `base`, `lg`, `xl`, `2xl` and `display` (page titles). The reader slider
  never touches it.
- **Scripture family**: `--scripture-size` (user-set, default 19px),
  `--scripture-leading` (1.95) and `--scripture-measure` (720px). Settings
  edits exactly these three (size, line spacing, column width) and the
  reader column reads them. Nothing else declares a scripture size.

A new text-corpus surface declares its own triple derived from the family
instead of hardcoding one, so the user's slider moves every corpus at
once. Two are pre-declared for the surfaces on the roadmap:

| Surface | Size | Leading | Measure |
|---|---|---|---|
| Interlinear (v0.5) | `--interlinear-size` = 0.85 x scripture | 1.5 | same as scripture |
| Church Fathers (v0.5) | `--fathers-size` = 0.95 x scripture | scripture - 0.15 | scripture - 80px |

Search results and preview cards quote scripture at UI sizes: they are UI
surfaces, not corpora.

### Hierarchy

- **Section heading** (`.section-heading`): 15px / 600, primary text, a
  hairline rule above (`.section-rule`) with generous space before, and an
  optional one-line description under (`.section-desc`). Settings sections,
  sidebar groups, rail headings, thread dividers.
- **Data label** (`.data-label`): the 11px uppercase micro-label, reserved
  for a label attached to a control or a datum (TESTAMENT, GENERATIONS, a
  book group in the picker, an entity type). It never does sectioning.
- Components declare sizes only from the scale and weights only from
  400 / 500 / 600 / 700, which the loaded faces ship. Literal pixel sizes
  fail the type-scale test.

## Components

Primitives live in `src/lib/components/ui/`. A surface uses the primitive
rather than restyling a `<button>` or `<div>`; if the primitive cannot do
what you need, extend it.

- **Button** (`Button.svelte`): primary / secondary / ghost / danger, three
  sizes. An icon-only button must pass `label`; it becomes the aria-label
  and the tooltip, and the prop types make an unlabelled `iconOnly` a
  compile error.
- **Icon-only rule** (issue #259): every icon-only button or link, hand
  rolled or not, carries an `aria-label` (its name) and a `title` (its
  tooltip). `src/lib/a11y-icon-controls.test.ts` scans every component and
  fails on a control that has only an icon and lacks either.
- **SelectTrigger** (`SelectTrigger.svelte`): the disclosure trigger for
  pickers and popovers; it opens a chooser and always carries a chevron.
- **SegmentedControl** (`SegmentedControl.svelte`): one exclusive choice
  among a few options. Two sizes (`sm` 24px segments for inline filters,
  `md` 28px for settings and toolbars). The active segment is marked with an
  accent underline on a raised surface, never an accent fill, so the
  switcher stops being the loudest element on the page. Arrow keys move the
  choice; a `shortcut` prop cycles it from anywhere on the page.

  **Overflow rule**: up to four options render as a segmented row. At five
  or more the same control renders as a labelled dropdown with the
  shortcut shown as a hint. Callers never branch on the count; the rule is
  `segmentedPresentation()` in `segmented.ts` and it is tested.

  Multi-select chips (the translation filter on the search page) are not
  segmented controls; they stay chips.

## Reader passage bar

Two zones, and a rule for what goes where:

- **Locate** (left): previous / next chapter and one book-and-chapter
  trigger that opens the passage picker (`PassagePicker.svelte`): type a
  book to filter or a reference such as `Ps 23`, arrows move the highlight,
  Enter goes, Escape closes; the chapter grid follows the highlighted book;
  the current location and its reading-time estimate sit at the top. The
  chapter-pill strip is a second presentation of the same control, shown
  only when it fits: `chapterStripMode()` in `utils/chapterStrip.ts` keeps
  pills for books of at most 25 chapters that fit the bar and folds them
  into the trigger otherwise (Psalms never gets a strip).
- **View** (right): search, the **Layers** menu, translation, scratch pad,
  split, Study Rail toggle. Display mode (Prose / Lines) is a Settings
  preference, not a bar control: it was in the bar briefly and read as
  bloat in testing.
- **Layers** (`LayersMenu.svelte`) is where every overlay the reader draws
  over the text lives: Entities (underline people, places and events; click
  to open), Red letter, Cross-references, Verse numbers. A new overlay
  (footnotes, provenance, v0.6 plugin layers) is a checkbox row here, never
  a new header icon.
- **Verse badges**: the cross-reference count and quotation badge sit
  inline after the verse, low contrast, click-only (no hover behaviour; a
  margin gutter was tried in #249 and rejected in testing as the wrong
  place for them). They follow the Cross-references layer, which is off by
  default for fresh profiles.
- Every icon-only control in the bar carries a `title` and an `aria-label`.

## Study Rail

The one right-hand column a reader pane has (`StudyRail.svelte`, state in
`stores/studyRail.svelte.ts`). Dictionary lookup, Who's here, entity
detail, lineage and plugin panels are all tabs on it; nothing else may
claim the column.

- **Header**, fixed 56px: kind icon, title, optional mono qualifier
  ("Person", "Gen 10:2", "Easton's"), overflow menu (close other tabs,
  close all, hide rail and keep tabs), close (closes the active tab).
- **Residency**: up to four tabs stay resident; showing a fifth evicts the
  least recently used. Re-showing an id updates it in place. Tabs survive
  chapter changes (the Who's here tab follows the chapter). The strip with
  count badges appears at two tabs; arrow keys move between them.
- **Per pane**: every pane has its own rail, so a split remembers which
  tab each side had. Hiding keeps tabs resident; the header toggle brings
  the last active tab back.
- **Resize**: drag the left edge, 320 to 520px, persisted as
  `studyRailWidth` in preferences.
- **Empty state**: the rail open with no tabs lists what it can show and
  how to get there: Who's here (a button, disabled when the chapter has no
  entities), word lookup (double-click any word), lineage (tap a Table of
  Nations name), annotations (a button). This is where discoverability for
  the invisible entry points lives.
- **Plugins** register panels as tabs of kind `plugin` through the same
  `rail.show()`; the reader renders their content in the tab body.
- On phones the rail overlays the pane; #253 turns it into a bottom sheet.

## Phones

The contract set before the v0.9 mobile pass (#68, #72), so v0.5 surfaces
have something to follow:

- **Pane header** at 48px with 44px targets: previous, next, one
  full-width passage trigger, Layers (icon only), translation, Study Rail.
  Search is the tab bar's; the scratch pad and split are desktop only.
- **Study Rail as a bottom sheet**: the same primitive, above the tab bar,
  with two stops (peek at 45vh, full). The grip toggles on tap and follows
  a swipe; the scrim hides the rail and keeps its tabs. Header, tab strip
  and body are unchanged.
- **Verse badges** get taller padding on touch.
- The passage picker stacks its book and chapter columns.

## Navigation

The sidebar is data (`src/lib/nav.ts`) in three groups, and a test pins
the grouping:

| Group | Holds | Today |
|---|---|---|
| Read | the reader | Read |
| Study | tools that operate on scripture | Search, Graph, Themes, Annotations |
| System | the app about itself | What's new, Settings (later: stats, plugins) |

**Placement rule.** Only a new workspace earns a nav entry. A new text
corpus (manuscripts, Church Fathers, commentary) is a pane type inside
Read. A new study tool is a Study Rail tab first. A new preference is a
Settings section. Nothing is added to the rail one item at a time.

**Collapsed state.** The rail collapses to `--sidebar-width-collapsed`
(48px) when the user folds it or a split claims the width. Group labels
hide, a hairline keeps the groups apart, and every item carries a `title`
and an `aria-label` because its text is gone.

**Phone tab bar.** Five slots, no groups: Read, Search, Graph, Themes,
Settings. Annotations is a reader mode there (the selection toolbar, the
Study Rail), not a tab.

## Radius

`--radius-xs` for text-level decoration (marks, flashes, kbd hints),
`--radius-sm` for controls, `--radius-md` for cards and fields,
`--radius-lg` for modals, `--radius-pill` for chips.
