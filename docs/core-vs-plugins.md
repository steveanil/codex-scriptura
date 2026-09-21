# Architectural Philosophy: Core vs. Plugins

One of the most critical architectural decisions in Codex Scriptura is determining what belongs in the core application and what should be implemented as a plugin. Getting this wrong leads to either a bloated core or a plugin system that lacks the capability to do anything useful.

## The Litmus Test

The fundamental question to ask when evaluating a feature is:

> *"If I remove this, is it still a Bible study app?"*

If yes → it's a **plugin**.
If no → it's **core**.

## What Belongs in Core?

Core features are the gravity that holds the platform together. A feature belongs in core if it meets any of the following criteria:

### 1. Other features depend on it
The core provides the foundational engines and data structures. For example:
- **Verse Reference Parser:** Core, because search, annotations, cross-references, plugins, and the reader all call it.
- **Annotation Layer:** Core, because highlights, notes, bookmarks, reading plans, and collaboration all write to the same data model.
- **Search Engine:** Core, because plugins need to hook into search results, rather than building their own search implementations.

### 2. Deep UI integration
If a feature requires deep integration into the user interface that cannot be sandboxed, it is core:
- **The Reading Pane:** Core, because it's where verse selection, text rendering, highlights, interlinear overlays, and plugin decorators converge.
- **Command Palette:** Core, as it's the universal entry point for commands, including those registered by plugins.
- **Navigation and Routing:** Core, because URL patterns (like `/read/GEN/1`) are fundamental contracts with the browser.

### 3. Trustworthy user data
User data that must be reliable and persistent belongs in core:
- **Annotations, Settings, and Sync:** Core. Users need to trust that their notes won't disappear if a plugin is uninstalled. Data must live in core tables so it isn't orphaned or deleted when plugin configurations change.

## What Is a Resource?

Between core and plugins sits a third category that the original two-way split missed: **resources**. A resource is content with metadata and no executable code: a translation, a commentary, a lexicon, a dictionary, a manuscript, a patristic corpus, a topical index, a lectionary. Resources are described by one universal `ResourceDescriptor` (what is it, where did it come from, may I use it, which version is installed) and stored in domain-specific tables, never in a polymorphic blob. They ship as `.csdata` packages, and the built-in datasets use the same format as installed ones.

Most of what was first imagined as "data plugins" is really resources. Matthew Henry, Nave's, the Church Fathers and a lectionary need an installer and an importer, not a sandbox. That is why the first extensibility milestone is a resource ecosystem and executable plugins come later. See [architecture-decisions.md](architecture-decisions.md) D2, D5 and D12.

## What Belongs as a Plugin?

Everything that is neither core nor a resource is a plugin. Even features that feel essential to a full Bible study experience are often best built as plugins. The core provides engines and data; **resources provide content; plugins provide views and behaviour**.

### Examples of Plugins

- **Commentaries:** The commentary resource model and the commentary Study Rail panel are core. Each specific commentary collection is a resource package. Hardcoding a specific commentary like Matthew Henry would make an editorial decision and require a core release for every new commentary.
- **Maps:** Plugins. The entity data (places) can be core, but the map renderer (like Leaflet or Mapbox) and the map tiles are plugins.
- **AI Assistants:** Plugins. They require network access, API keys, and make opinionated theological inferences. You don't want the core offline experience to depend on an external AI API's uptime.
- **Audio Bibles:** Plugins. The sync protocol (`onVerseChange`) is a core hook, but the actual media player and file management are handled by the plugin.
- **Doctrine / Specialized Tools:** Specialized views over data (like a Doctrine Development Tracker) are plugins. The underlying data model (entities, timelines, verse linkages) belongs in core, but the specialized UI is a first-party plugin.
- **Graph Visualizations:** The cross-reference graph data model and the genealogy engine (`buildPersonSubgraph`) are core - other features depend on querying them. But the *rendering layer* (force simulation, tree layout, node styling, progressive-disclosure zoom) is a first-party plugin. This means an alternative graph renderer can be swapped in by a plugin without modifying core, and the built-in renderer follows the same plugin API conventions it exposes to third parties.
- **Story Mode:** The narrative data model (`narratives` table, step schema, seed narrative JSON) is core - search and cross-references benefit from knowing which passages belong to which narrative. The guided reading UI is core too: it ships at v1.0.0, before the plugin runtime exists, and is not planned for extraction (architecture-decisions.md D16). The same goes for the Gospel harmony viewer (#198).

## Core vs. Plugin Examples

| Core Provides | Resources Provide | Plugins Provide |
| :--- | :--- | :--- |
| Text rendering engine | Translations | |
| Annotation data layer | | Specialized annotation UIs (journal, sermon notes) |
| Search engine | | Search filters and custom result views |
| Resource manager, `.csdata` installer | Every content package | |
| Plugin API + sandbox | | Everything that runs against the API |
| Graph data model (nodes, edges, `buildPersonSubgraph`) | | Graph layout algorithms and visualizations (force layout, tree layout, alternative renderers) |
| Entity tables (people, places) | | Rich UI for exploring entities (maps, genealogies) |
| Narrative data model (`narratives` table, steps) and the Story Mode player | Seed narratives | |
| Atlas basemap rendering and places-in-passage lookup | Basemap, later map layers (#382) | |
| Cross-reference storage and Study Rail | Specific cross-reference datasets | Large interactive canon graph |
| Lexicon lookup API | Specific lexicon data (BDAG, HALOT) | |
| Commentary model and Study Rail panel | Specific commentary collections | |
| Panel/sidebar framework | | What renders inside those panels |

## The Contributor Test

If you are ever unsure, imagine a contributor submits a PR adding the feature. 
- If you would accept it into `src/` or `packages/core`, it's core.
- If you would say "this should be in `plugins/`", it's a plugin. 

**Rule of thumb:** Err toward making it a plugin. You can always promote a successful plugin to core later, but extracting a core feature into a plugin is a painful refactoring process.

---
> **Developer Note:** For technical details on *how* to build a plugin, including the manifest, hooks, and lifecycle methods, see the [Plugin API Stub](./plugin-api.md).
