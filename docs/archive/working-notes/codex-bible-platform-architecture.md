# Codex - An Open-Source Biblical Research Platform

## Vision

Codex is the "VS Code of Bible study" - a lightweight, offline-first, plugin-extensible web platform that gives pastors, scholars, seminarians, and curious readers the depth of Logos and the flexibility of Obsidian, without the $1,500 price tag or vendor lock-in.

**One-line pitch:** What if Obsidian, Logos, and Zotero had a baby - and it was free?

---

## Honest Assessment of Your Feature List

Your instincts are strong. Here's what I'd refine:

**Keep exactly as-is (these are your differentiators):**

- Plugin system - this is the single most important architectural decision. It's what lets a small team build something that competes with Logos's 20-year head start.
- Offline-first - scholars work on planes, missionaries work in villages. Non-negotiable.
- Doctrine Development Tracker - nothing else does this. It's your "killer feature" for academic users.
- Manuscript Comparison - same. This pulls in textual criticism users who currently cobble together tools.
- Cross-Reference Graph - Obsidian's graph view applied to scripture is immediately compelling.
- Church Fathers Library - massively underserved. The texts are public domain. Low cost, high value.

**Merge or restructure (overlapping concerns):**

- "Original Language Parsing," "Morphology Search," "Interlinear Mode," and "Greek/Hebrew Learning Mode" are all facets of one system: a **Biblical Languages Engine**. Build one engine, expose it four ways.
- "Highlighting," "Personal Notes," and "Verse Memorization" are all part of a **User Annotation Layer**. One data model, multiple UI surfaces.
- "Word Frequency Tools" is a view on top of the morphology data, not a separate feature.
- "Audio Bibles" and "Maps/Biblical Geography" are perfect plugin candidates, not core features. Keep the core lean.

**Deprioritize (high effort, low differentiation):**

- AI Study Assistant - powerful but risky to build early. LLM APIs change fast, hallucination liability is real for biblical text. Make this a plugin with a clean interface so the community can iterate.
- Timeline Mode - nice to have, but complex to get right. Phase 3.
- Quote Verification - extremely hard to automate well. Better as a manual workflow supported by good search.

**Add (things you're missing):**

- **Import/Export from Logos, Accordance, e-Sword** - migration paths are how you steal users.
- **Citation Export** - scholars need Turabian/Chicago/SBL footnotes. One-click cite a verse + commentary passage.
- **Reading Plans as Data** - let users create, share, and fork reading plans like GitHub repos.
- **Collaboration Mode** - shared annotations for study groups or seminary classes.
- **Sync Strategy** - offline-first needs a sync story. CouchDB/PouchDB pattern or CRDTs.

---

## Refined Feature Architecture

### Core Platform (what the team builds and owns)

```
┌─────────────────────────────────────────────────────────┐
│                    CODEX PLATFORM                        │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Text Engine │  │  Annotation  │  │    Plugin      │  │
│  │             │  │    Layer     │  │    Runtime     │  │
│  │ • OSIS/USFM │  │ • Notes      │  │ • Sandboxed   │  │
│  │ • Versifica- │  │ • Highlights │  │ • API surface │  │
│  │   tion       │  │ • Bookmarks  │  │ • Event bus   │  │
│  │ • Parallel   │  │ • Tags       │  │ • UI slots    │  │
│  │   display    │  │ • Links      │  │ • Data access │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                │                   │          │
│  ┌──────┴────────────────┴───────────────────┴───────┐  │
│  │              Unified Data Layer                    │  │
│  │  IndexedDB + OPFS │ CRDT Sync │ Open Export       │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Languages  │  │    Graph     │  │    Search      │  │
│  │   Engine    │  │    Engine    │  │    Engine      │  │
│  │             │  │              │  │               │  │
│  │ • Lexicon   │  │ • Cross-refs │  │ • Full-text   │  │
│  │ • Morphology│  │ • Note links │  │ • Morphology  │  │
│  │ • Parsing   │  │ • Doctrine   │  │ • Semantic    │  │
│  │ • Interlin. │  │   trees      │  │ • Faceted     │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Plugin-Provided (community builds these)

| Category | Example Plugins |
|---|---|
| **Texts & Translations** | ESV, NASB (with license), Septuagint, Vulgate, Peshitta |
| **Commentaries** | Calvin's Institutes, Aquinas's Catena Aurea, Chrysostom Homilies |
| **Tradition Packs** | Catholic (Magisterium docs, CCC references), Orthodox (Philokalia, liturgical calendar), Reformed (Westminster Standards, Three Forms of Unity) |
| **Language Tools** | Greek pronunciation audio, Hebrew cantillation, Aramaic grammar |
| **AI Assistants** | GPT/Claude-powered study helper, sermon prep assistant |
| **Media** | Audio Bibles, maps, archaeological photos, artwork |
| **Academic** | Manuscript viewer, apparatus integration, critical edition tools |
| **Workflow** | Reading plans, memorization trainer, sermon note templates |
| **Export** | Logos import, Accordance import, Zotero sync, citation formatter |

---

## Technical Architecture

### Stack

| Layer | Technology | Rationale |
|---|---|---|
| **UI Framework** | SolidJS or Svelte 5 | Smaller bundle than React. Offline apps need to be lean. Fine-grained reactivity for complex text rendering. |
| **State** | CRDT-based (Yjs or Automerge) | Enables offline-first with eventual sync. Collaboration comes free. |
| **Storage** | IndexedDB via Dexie.js + OPFS for large texts | Offline-first. OPFS gives near-native file performance for big datasets. |
| **Search** | MiniSearch (client-side) + optional MeiliSearch (self-hosted) | Full-text search works offline. Upgraded search for power users. |
| **Graph** | D3.js force graph or Cytoscape.js | Cross-reference and doctrine graph visualization. |
| **Languages** | Custom parser over MorphGNT + ETCBC (Hebrew) | Open morphological datasets. Parse once, index in IndexedDB. |
| **Plugin Runtime** | Web Workers + iframe sandbox + message bus | Plugins can't crash the host. Controlled API surface. |
| **Sync Server** | Optional. Hocuspocus (Yjs) or self-hosted CouchDB | Users own their data. Sync is opt-in. |
| **PWA** | Service Worker + Web App Manifest | Installable on any device. Works fully offline. |
| **Build** | Vite | Fast dev, good tree-shaking for lean production builds. |

### Data Model

```
Bible Text (immutable, loaded from open datasets)
├── Translation
│   ├── Book
│   │   ├── Chapter
│   │   │   ├── Verse
│   │   │   │   ├── tokens[] (word-level, with morphology refs)
│   │   │   │   ├── cross_references[]
│   │   │   │   └── variants[] (manuscript comparison)

User Data (mutable, CRDT-synced)
├── Annotations
│   ├── notes (markdown, linked to verse ranges)
│   ├── highlights (color, verse range)
│   ├── tags (user-defined taxonomy)
│   └── links (bidirectional, Obsidian-style [[wikilinks]])
├── Collections
│   ├── reading_plans
│   ├── study_sessions
│   └── word_lists
├── Research
│   ├── doctrine_trees (structured argument maps)
│   └── manuscript_notes

Plugin Data (namespaced per plugin)
├── plugin_id:key → value (JSON, scoped storage)
```

### Plugin API Surface

```typescript
interface CodexPluginAPI {
  // Registration
  register(manifest: PluginManifest): void;

  // Bible Text (read-only)
  text.getVerse(ref: VerseRef, translation?: string): Verse;
  text.getRange(start: VerseRef, end: VerseRef): Verse[];
  text.search(query: string, options?: SearchOptions): SearchResult[];
  text.getMorphology(token: TokenRef): MorphologyData;
  text.getLexicon(lemma: string): LexiconEntry;

  // User Annotations (read-write with permission)
  annotations.create(annotation: Annotation): void;
  annotations.query(filter: AnnotationFilter): Annotation[];

  // UI Extension Points
  ui.registerSidePanel(id: string, component: Component): void;
  ui.registerContextMenu(id: string, items: MenuItem[]): void;
  ui.registerVerseDecorator(id: string, decorator: VerseDecorator): void;
  ui.registerTopBar(id: string, component: Component): void;
  ui.registerSettingsPage(id: string, component: Component): void;

  // Events
  events.on(event: CodexEvent, handler: EventHandler): void;
  // Events: verse-selected, chapter-changed, note-created,
  //         search-executed, plugin-message, etc.

  // Inter-Plugin Communication
  messages.send(targetPlugin: string, message: any): void;
  messages.onReceive(handler: MessageHandler): void;

  // Storage (namespaced to plugin)
  storage.get(key: string): any;
  storage.set(key: string, value: any): void;
}
```

### Open Bible Data Sources

| Dataset | Content | License |
|---|---|---|
| **MorphGNT (SBLGNT)** | Greek NT with full morphological tagging | CC BY-SA |
| **ETCBC / BHSA** | Hebrew Bible with syntax trees | CC BY |
| **OpenBible.info cross-refs** | 340,000+ cross-reference pairs | CC BY |
| **STEP Bible Data** | Lexicons (BDB, LSJ summaries), tagged text | CC BY |
| **unfoldingWord resources** | ULT/UST translations, translation notes | CC BY-SA |
| **CCEL texts** | Church Fathers, historical theology | Public domain |
| **Perseus Digital Library** | Greek/Latin classical + patristic texts | CC |
| **Berean Standard Bible** | Modern English translation | Public domain |
| **World English Bible** | Modern English translation | Public domain |
| **OSIS XML schemas** | Standard Bible markup format | Open |

---

## Development Phases

### Phase 0 - Foundation (Months 1–3)

**Goal:** A usable Bible reader with the architectural bones that everything else builds on. If this phase doesn't feel good to use, nothing else matters.

**Deliverables:**

1. Project scaffolding - Vite + SolidJS/Svelte, PWA config, IndexedDB schema
2. **Text Engine v1** - load and render WEB/BSB from bundled OSIS data. Chapter navigation, verse selection.
3. **Parallel View** - side-by-side translations (start with 2–3 open-license texts)
4. **Basic Annotation Layer** - highlight verses, attach plain-text notes
5. **Offline storage** - all text data in IndexedDB, works without network
6. **Plugin Architecture v1** - manifest format, sandbox, 3 extension points (side panel, verse decorator, context menu). Ship with one example plugin.
7. **Search v1** - full-text verse search with book/testament filters

**Technical Milestones:**

- Data pipeline: OSIS XML → JSON → IndexedDB (automated, repeatable)
- < 2MB initial bundle (text data lazy-loaded)
- Lighthouse PWA score > 90
- Plugin loads in < 100ms in Web Worker

**Why this phase matters:** You need people using it daily as a basic Bible reader before you layer on academic features. If the reading experience is bad, scholars will stay on Logos.

---

### Phase 1 - Languages & Linking (Months 4–7)

**Goal:** The features that make seminary students and pastors switch.

**Deliverables:**

1. **Biblical Languages Engine** - load MorphGNT and ETCBC data. Per-word morphological parsing. Tap a Greek/Hebrew word → see parsing, gloss, lemma.
2. **Interlinear Mode** - toggle between:
   - Inline gloss (hover for detail)
   - Full interlinear (original + transliteration + gloss + translation, stacked)
   - Original text only
3. **Integrated Lexicon** - BDB (Hebrew) and a Greek lexicon from STEP data. Linked from every word.
4. **Morphology Search** - "find every aorist passive subjunctive in Paul's letters." Query builder UI.
5. **Cross-Reference Graph** - visualize cross-references as a force-directed graph. Click a verse → see its reference network. Uses OpenBible.info data.
6. **Wikilink Notes** - Obsidian-style `[[bidirectional links]]` between notes. Backlinks panel. Note graph view.
7. **Plugin API v2** - expose text.getMorphology(), text.getLexicon(), graph data access.

**Key Data Work:**

- MorphGNT import pipeline (lemma → lexicon lookup index)
- ETCBC Hebrew morphology import
- Cross-reference graph database in IndexedDB
- Word frequency index (precomputed per book, author, genre)

---

### Phase 2 - Research & Academic (Months 8–12)

**Goal:** The features that make scholars take this seriously.

**Deliverables:**

1. **Commentary Integration** - framework for displaying commentary alongside text. Ship with public domain commentaries (Matthew Henry, Calvin, Chrysostom). Plugin-loadable for licensed content.
2. **Church Fathers Library** - import CCEL/Perseus patristic texts. Full-text search. Link Father quotes to Bible verses.
3. **Doctrine Development Tracker** - for a given doctrine (e.g., "Trinity," "Justification"):
   - Show relevant scriptures
   - Show earliest patristic references (auto-linked from Fathers library)
   - Show conciliar definitions
   - Show later theological formulations
   - User can add their own nodes to the tree
   - Visualized as a timeline + graph hybrid
4. **Manuscript Comparison** - for a selected verse:
   - Base text (NA28/SBLGNT)
   - Significant textual variants
   - Manuscript witnesses for each variant
   - Brief textual apparatus note
   - Uses open apparatus data (SBLGNT apparatus, unfoldingWord)
5. **Citation Export** - select a verse + commentary passage → export as SBL, Turabian, or Chicago footnote. Copy to clipboard or send to Zotero.
6. **Word Frequency & Distribution** - visualize where a Greek/Hebrew word appears across the canon. Hapax legomena finder. Semantic domain clustering.
7. **Tag Taxonomy** - user-defined tagging system for notes. Theological topic search across personal notes.

---

### Phase 3 - Community & Ecosystem (Months 13–18)

**Goal:** Make it self-sustaining.

**Deliverables:**

1. **Plugin Marketplace** - browse, install, rate, and review community plugins. GitHub-based submission pipeline.
2. **Reading Plans as Forkable Data** - create, share, and remix reading plans. Public plan library.
3. **Collaboration Mode** - shared annotation layers for study groups. Real-time co-reading (CRDT sync).
4. **Sync Service** - optional hosted sync (or self-host instructions). End-to-end encrypted user data.
5. **Import Wizards** - import notes/highlights from Logos, Accordance, YouVersion, e-Sword.
6. **Timeline Mode** - visual chronological view of biblical events. Synced with reading position.
7. **Maps & Geography Plugin** - shipped as first-party plugin. Ancient Near East maps, site photos, archaeological layers.
8. **Audio Bible Plugin** - playback synced to verse position. Open-license recordings.
9. **AI Study Assistant Plugin** - LLM-powered (user provides their own API key). Contextual questions, passage summaries, cross-tradition comparison. Clearly labeled as AI-generated.
10. **Mobile-optimized PWA** - responsive redesign, touch gestures, bottom navigation.

---

### Phase 4 - Maturity (Months 18+)

**Ongoing:**

- Historical theology source criticism mode
- Liturgical calendar integration (plugin)
- Original-language learning mode (spaced repetition for vocabulary)
- Academic peer review workflow for community commentaries
- API for third-party integrations
- Performance optimization for low-end devices
- Accessibility audit (screen readers, high contrast, keyboard navigation)
- Localization (UI in 20+ languages)

---

## Architecture Principles

1. **Offline-first is not a feature, it's a constraint.** Every feature must work without a network connection. Network is an enhancement.

2. **Data is the user's, forever.** All user data exportable as standard formats (Markdown, JSON, CSV). No proprietary lock-in.

3. **Core stays lean, plugins add depth.** If a feature only matters to one tradition or one use case, it's a plugin. The core serves everyone.

4. **Open data, open formats.** Bible text stored as OSIS/USFM internally. Notes as Markdown. Graph data as JSON. Everything inspectable.

5. **Plugin authors are first-class citizens.** Good docs, good API, fast feedback loops. The plugin ecosystem is the moat.

6. **Performance budget:** < 3MB initial load. < 500ms to interactive. < 100ms verse navigation. If it's slower than flipping a paper Bible page, it's too slow.

---

## What Makes This Win

**vs. Logos:** Free. Open. Offline. No $1,500 base library. Plugin ecosystem means the community builds what Faithlife's product team never prioritizes.

**vs. YouVersion:** Depth. YouVersion is for devotional reading. Codex is for study and research. Different audiences, minimal overlap.

**vs. Blue Letter Bible / BibleHub:** Integrated experience. Those sites are reference tools. Codex is a workspace where your notes, research, and reading live together.

**vs. Obsidian + Bible plugins:** Purpose-built text engine. Obsidian Bible plugins are limited by Obsidian's general-purpose architecture. Codex can do morphology search, interlinear display, and manuscript comparison because those are first-class concerns.

**vs. STEP Bible:** Modern UX. STEP has great data but the interface is from 2012. Codex wraps the same open data in a contemporary, extensible interface.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Scope creep** | High | High | Ruthless phasing. Phase 0 ships in 3 months or the project is in trouble. |
| **Bible text licensing** | Medium | High | Start with public domain / CC-licensed texts only. ESV/NIV/NASB are plugin territory with proper licensing. |
| **Plugin security** | Medium | High | Sandbox from day one. Web Worker isolation. Permission model (like browser extensions). |
| **Performance on mobile** | Medium | Medium | OPFS for large datasets. Virtualized rendering for long chapters. Lazy-load everything. |
| **Community adoption** | Medium | High | Ship something useful in Phase 0. Get it in front of seminary students immediately. |
| **Contributor burnout** | High | High | Keep the core team small (2-4). Make plugin development the on-ramp for contributors. |
| **AI hallucination liability** | Medium | Medium | AI is a plugin, not core. Label all AI output clearly. User provides their own API key. |

---

## Suggested Team Structure

**Core team (Phase 0–1):** 2–4 developers

- 1 platform/architecture lead (plugin system, data layer, offline)
- 1 frontend/UX lead (reading experience, annotation UI)
- 1 biblical languages/data lead (text pipelines, morphology, lexicon integration)
- 1 community/docs lead (part-time, ramps up in Phase 2)

**Community contributors (Phase 2+):**

- Plugin developers (self-organized around traditions and use cases)
- Data contributors (commentary digitization, cross-reference improvements)
- Translators (UI localization)
- Testers (seminary students are ideal beta users)

---

## Naming Note

"Codex" is a working name - it references the codex form that replaced scrolls and made Bible study practical. Alternatives worth considering: **Berith** (covenant), **Scripta**, **Parchment**, **Ostracon**, **Ketiv** (Hebrew: "what is written").
