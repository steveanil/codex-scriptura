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
| Church Fathers (v0.6, a resource read in a text pane) | `--fathers-size` = 0.95 x scripture | scripture - 0.15 | scripture - 80px |

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
- **Card kicker** (`.card-kicker`): the 11px mono uppercase label that
  identifies a bounded card section (the Settings cards). Used only where
  the containing card already supplies the section boundary; it does not
  replace `.section-heading` on uncontained page sections.
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
  (footnotes, provenance, speaker marking, resource-driven decorations at
  v0.6, plugin decorations at v1.1) is a checkbox row here, never a new
  header icon, and it draws through the decoration grammar below.
- **Verse badges**: the cross-reference count and quotation badge sit
  inline after the verse, low contrast, click-only (no hover behaviour; a
  margin gutter was tried in #249 and rejected in testing as the wrong
  place for them). They follow the Cross-references layer, which is off by
  default for fresh profiles.
- Every icon-only control in the bar carries a `title` and an `aria-label`.

### Decoration grammar

Where the toggle lives is the easy half. The hard half is what several
active layers do to the same run of text, and it gets harder with every
layer added. So the reader owns a finite set of semantic channels, and
every decoration, core or not, is a request for one of them:

| Channel | Carries | Occupied today by |
|---|---|---|
| Text colour | who is speaking | Red letter |
| Underline / mark | a name or term the reader can open | Entity marks |
| Background emphasis | a span singled out | Highlights (the user's), divergence shading, the search hit and jump flash (transient) |
| Inline badge | a count or pointer after the verse | Cross-reference and quotation badges |
| Structural marker | where the text is, not what it says | Verse numbers, bridged ranges; footnote callouts later |

Rules:

- **One occupant per channel per span.** Two decorations that want the
  same channel on overlapping text do not stack: nothing draws a second
  underline or a second tint. Precedence on a collision is the user's own
  marks, then core layers, then resource decorations, then plugin
  decorations, and inside a tier the layer higher in the Layers menu
  wins. The loser is not drawn on that span; it is not restyled.
- **A decoration names a channel and a tone, never a style.** The
  `VerseDecoration` shape in [plugin-api.md](plugin-api.md) asks for
  `underline`, `highlight` or `emphasis` with a `tone`; those are requests
  for the underline, background and text-colour channels, and the reader
  maps them onto tokens. Badges and structural markers are not open to
  resources or plugins. No CSS crosses the boundary (D7).
- **Tones are tokens.** A decoration draws from the categorical pool
  (`--cat-*`), `--color-mark` for attention, or the channel's own token
  (`--dv-shade`, the red-letter pair). Nothing supplies a hex value.
- **One authoritative control per optional reader layer.** Layers is the
  in-reader home for toggling optional overlays; Settings may mirror a
  persistent layer preference, as it does for cross-references. Transient
  states (search hits, the jump flash, selection, divergence shading) and
  user-authored marks (highlights) occupy channels but are not Layers
  entries. A decoration does not imply a checkbox.
- **A decoration that fits none of the five channels is a design-system
  change first**: extend this table and write the rule, then build it.

## Study Rail

The one right-hand column a reader pane has (`StudyRail.svelte`, state in
`stores/studyRail.svelte.ts`), and a core host surface: the host owns the
column, the tab model and every tab's chrome. Three kinds of thing appear
as tabs, in the order they arrive: core tools (dictionary lookup, Who's
here, entity detail, lineage, all shipped), resource-backed content (a
commentary, dictionary or patristic-citation tab at v0.6, a host-owned
tab kind with the resource as its selected content) and, at v1.1, panels
registered by executable plugins. Extensible content does not make a tab
a "plugin panel": at v0.6 nothing on the rail executes third-party code.
Nothing else may claim the column.

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
- **Resource tabs** (v0.6.0): a passage-contextual resource type gets one
  host-owned tab kind (commentary, dictionary entry, citations); which
  commentary or dictionary fills it is a selection inside the tab, the
  way a pane selects a translation. The host draws the header, qualifier
  and body; the resource supplies content.
- **Plugin contract** (v1.1.0): an executable plugin registers a panel
  through `registerPanel` ([plugin-api.md](plugin-api.md)) and it appears
  as a tab of kind `plugin` through the same `rail.show()`, rendered
  inside a container the host owns. The kind exists in `RailTabKind`
  today so nothing else can claim the column later.
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

## Settings

The page is a sticky section rail (168px, scroll-spied, a chip row on
phones) beside a column of raised cards, one per section
(`SettingsCard.svelte`), each opening with a `.card-kicker` header strip.
Rows (`SettingRow.svelte`) are label and hint on the left, control on the
right, 52px minimum, a hairline between; a wide control stacks under its
text. A control that is unavailable because something is missing keeps
its full contrast, loses its pointer, and says why and what to do on one
line beneath it (the red-letter row when WEB is not installed). The
reader specimen at the top of the Reader card draws from the same tokens
the reader uses, so every control shows its effect.

### Library

Library is the user-facing name; the architecture calls the same surface
the Resource Manager (D2, D12), and at v0.6.0 the two converge:
translations, commentaries, dictionaries, topical Bibles, the Church
Fathers and sideloaded `.csdata` all install, update and uninstall here.
Today's category list (Translations, Manuscripts, Lexicons, Church
Fathers) is a placeholder from the old corpus split; the descriptor's
`type` replaces it, and filtering is by type and by installed state, with
counts (the segmented-control overflow rule applies at five or more).

A resource row shows four things at rest: title, one meta line (type,
then only the facts that change what the row can do: tagged, aligned,
coverage), installed state with size, and the single action that fits the
state (Install, Update, Remove, Retry). Version, license, provenance,
delivery mode and permitted capabilities live one disclosure deeper, in
the row's detail, so a row is never a wall of metadata and every fact
still has a home. License and provenance read from the descriptor; the
credits screen (#235) reads the same fields.

## Navigation

The sidebar is data (`src/lib/nav.ts`) in three groups, and a test pins
the grouping:

| Group | Holds | Today |
|---|---|---|
| Read | the reader | Read |
| Study | tools that operate on scripture | Search, Graph, Themes, Annotations |
| System | the app about itself | What's new, Settings (later: stats, plugins) |

**Placement rule.** Placement follows how a thing behaves, not what kind
of content it is:

- Passage-contextual information, read beside the verse the reader is
  on, is a Study Rail tab: a dictionary entry, a commentary note, a
  patristic citation, Who's here.
- Independently navigable long-form text, read on its own terms, is a
  reader pane: a manuscript transcription, a Church Father, a commentary
  opened for continuous reading. Commentary is either, by reading mode,
  and a rail tab may escalate into a pane the way lineage escalates into
  the full tree.
- An immersive tool with its own interaction model earns a workspace and
  a nav entry: Graph today, timeline and manuscript-explorer tools later.
  D8 lets plugins register views and panels along the same line.
- A new preference is a Settings section. Nothing is added to the sidebar
  one item at a time.

**Pane rule.** A pane is core pane shell, then pane type, then selected
resource, never resource then custom UI. `PaneState` is the unit of
reader state: a scripture pane selects a translation, a commentary pane
is the same core UI selecting Matthew Henry or Calvin, a text pane
selects a Father. A resource never brings its own chrome. At v1.1 an
executable plugin may register a further semantic pane or view through
the host API, and it does not own app chrome either.

**Collapsed state.** The rail collapses to `--sidebar-width-collapsed`
(48px) when the user folds it or a split claims the width. Group labels
hide, a hairline keeps the groups apart, and every item carries a `title`
and an `aria-label` because its text is gone.

**Phone tab bar.** Five slots, no groups: Read, Search, Graph, Themes,
Settings. Annotations is a reader mode there (the selection toolbar, the
Study Rail), not a tab.

## Resource capabilities and degradation

D14 makes a resource's rights part of its descriptor, and capabilities
are explicit there, never inferred from delivery mode. A local `.csdata`
translation can support persistent offline use, while search,
concordance, alignment, export and every other derived capability remain
descriptor-driven (YLT and OEB are local and carry no alignment).
Licensed-remote resources additionally constrain capabilities according
to provider policy. The interface treats every absent capability as
information, not as a fault:

- **Status treatments are neutral.** "Online only", "Offline: limited",
  "Search not available", "Export not available" are mono metadata (a
  `.data-label`, muted text) in the Library row detail and on the
  translation picker. They never use the danger colour, a warning icon or
  an alert. Red means something went wrong; a right the license withholds
  has not gone wrong.
- **An absent capability is absent everywhere it would appear.** A
  translation without full-text search is not listed in the search
  multi-select; Word Study says original-language alignment is not
  available for it; backup and export leave it out with one line saying
  so. No control is offered and then fails.
- **An unavailable control keeps its full contrast, loses its pointer and
  says why on one line beneath**, the rule the Settings section already
  sets for the red-letter row. The line names the reason (license,
  offline, not installed) and, where one exists, the action.
- **Offline is a state of the resource, not of the app.** A remote
  translation that cannot be reached shows the chapters it has cached and
  a neutral "not available offline" line where it has none; the rest of
  the reader is unchanged.
- The vocabulary is fixed here, before licensed translations land
  (v0.9.0), so the ESV and API.Bible rows arrive into it instead of
  inventing one.

## Radius

`--radius-xs` for text-level decoration (marks, flashes, kbd hints),
`--radius-sm` for controls, `--radius-md` for cards and fields,
`--radius-lg` for modals, `--radius-pill` for chips.
