# Architecture Decisions

Decisions that shape where the codebase is going, as opposed to [architecture.md](architecture.md), which describes what exists today. Each entry is dated. When a decision is superseded, add a new entry rather than editing the old one.

## Two principles

**Core provides universal study primitives. Resources provide content. Plugins provide specialized behaviour and presentation. Cloud provides distribution and shared state. Core study remains local and functional without the latter three.**

**An abstraction is introduced when an existing implementation boundary requires it, not because the roadmap predicts that it may eventually be useful.**

The second principle is the tie-breaker for every proposal below. Several attractive layers (repository classes, a package-per-concern monorepo, workers for everything) were rejected under it, and the decisions record why so the argument does not have to be re-had.

## End-state architecture

Recorded 2026-09-16. This is the shape to keep in mind while building everything else. Four boundaries, not twenty.

```
                              CODEX SCRIPTURA

+-----------------------------------------------------------------+
|                            CORE                                 |
|                                                                 |
|  Reader         Search infrastructure       Study Rail          |
|  Navigation     Reference parsing           Annotations         |
|  Routing        Resource APIs               Preferences         |
|  Word study     Backup/import primitives    Plugin host         |
|                                                                 |
|  Core owns universal Bible-study primitives and trusted         |
|  user data.                                                     |
+------------------------------+----------------------------------+
                               |
                               v
                    +--------------------+
                    | RESOURCE SYSTEM    |
                    |                    |
                    | ResourceDescriptor |
                    | Dataset Manager    |
                    | Resource Manager   |
                    | .csdata format     |
                    +---------+----------+
                              |
         +--------------------+--------------------+
         |                    |                    |
         v                    v                    v
    Translations         Commentaries        Other content
    Lexicons             Church Fathers      Topics
    Cross-refs           Manuscripts         Lectionaries
    Entities             Dictionaries        etc.
         |
         | all first-party resources use the same logical
         | package/manifest model as external resources
         v
+-----------------------------------------------------------------+
|                         LOCAL STORAGE                           |
|                                                                 |
|  CORE DB                                                        |
|  +-- System/resource data: replaceable, versioned               |
|  +-- User data: durable, exportable, never silently deleted     |
|                                                                 |
|  PLUGIN DBs                                                     |
|  +-- one database per executable plugin                         |
+-----------------------------------------------------------------+

                          LATER

                    +--------------------+
                    |    PLUGIN API      |
                    | async/serializable |
                    | RPC-shaped         |
                    +---------+----------+
                              |
                +-------------+-------------+
                |                           |
                v                           v
        Trusted first-party          Sandboxed third-party
        same API, direct call        same API, RPC transport
                |                           |
                +-------------+-------------+
                              |
                Specialized behavior/views
                +-- Scripture Graph
                +-- Genealogy Explorer
                +-- Timeline
                +-- Manuscript Explorer
                +-- Gospel Harmony
                +-- AI integrations
                +-- third-party extensions

                      REMOTE / OPTIONAL

        E2EE SYNC TO USER-OWNED STORAGE
        +-- Google Drive app-data
        +-- Dropbox later
        +-- no Codex account required
        +-- Codex cannot read plaintext payloads

        STATELESS CODEX INFRASTRUCTURE
        +-- licensed-resource proxy
        +-- secrets only
        +-- no user study storage

        MANAGED CODEX BACKEND (later)
        +-- marketplace
        +-- shared study guides
        +-- collaboration
        +-- community features
```

The remote side is three systems with different trust and ownership models, never one "cloud" box. Personal sync is encrypted client-side and stored on the user's own Drive or Dropbox; it is remote but not a Codex service, needs no account, and Codex never holds a key ([sync-and-accounts.md](sync-and-accounts.md)). Stateless infrastructure exists only to hold provider credentials for licensed translations and stores nothing about the user (D13). The managed backend appears only for community features. Core study never depends on any of the three.

**Package structure.** Preserve the current one-way dependency structure. New workspace packages are introduced only when justified by a distinct runtime, multiple consumers, an independent dependency graph or build target, a security boundary, a worker bundle, or a distributable SDK. Directory boundaries are preferred otherwise. A box on the diagram is not a reason for a package.

```
app
 +-- core
 +-- db
 |    +-- core
 +-- plugin-api          later
 +-- other packages      only when justified above

data-pipeline
 +-- core

core
 +-- no infrastructure dependencies
```

### The short form

```
                         CODEX SCRIPTURA

                              CORE
                               |
             +-----------------+-----------------+
             |                 |                 |
         Study UX           Domain           User Data
             |                 |                 |
             +-----------------+-----------------+
                               |
                         Resource System
                               |
           +-------------------+-------------------+
           |                   |                   |
     Translations         Commentaries        Other Resources
     Lexicons             Fathers             Topics / etc.
     Crossrefs            Manuscripts
           |                   |                   |
           +------------- .csdata model -----------+
                               |
                          Local Storage
                               |
                  +------------+------------+
                  |                         |
              Core DB                  Plugin DBs
          system + user data          isolated schemas


                              LATER

                           Plugin API
                        async / RPC-shaped
                               |
                +--------------+--------------+
                |                             |
       Trusted first-party           Sandboxed third-party
          direct transport               RPC transport
                |                             |
                +---------- same API ---------+


                             REMOTE

               E2EE sync to user-owned storage
                 Google Drive / Dropbox
                 no Codex account required

                               +

               Stateless Codex infrastructure
                 licensed-resource proxy
                 secrets only, no user data

                               +

                    Managed Codex backend
                    marketplace
                    shared guides
                    collaboration
                    community
```

This target is considered stable as of 2026-09-16. Implementation is optimised toward it; further redesign needs a new dated decision below, not an edit to this section.

At build time the pipeline stays as it is: fetch, import, normalise, enrich, validate, then emit a dataset manifest alongside versioned dataset artifacts.

## Decisions, 2026-09-16

### D1. Dataset version is separate from schema version

**Today.** The Dexie schema number is the only re-seed lever. Of 29 schema versions, roughly two thirds exist to clear a table so its count-based seed gate fires again after a pipeline fix. On-demand translations already broke this model: one dataset cannot be corrected without a global bump every profile pays for.

**Decision.** Add a `datasets` table and ship a dataset manifest from the pipeline. Dexie versions move only when the storage shape changes.

```ts
interface InstalledDataset {
  id: string;             // "kjv", "crossrefs", "theographic"
  version: string;        // from the shipped manifest
  contentHash: string | null;
  installedAt: number;
  recordCount: number;    // sanity check only, no longer the identity
  resourceId?: string;    // once D2 lands
}
```

The manifest is written by `copy-to-static.ts`, hashing each logical dataset before splitting, and served next to the data. Identity is `id + version + contentHash`. Record count stays as a sanity check.

**Migration.** One last data-driven bump, v30, adds the table and backfills a row per seeded dataset with `version: "legacy"` and `contentHash: null`. On the next boot every legacy row mismatches the manifest and is replaced once. After that there should be zero legacy rows.

**Flow.**

```
schema changed              -> Dexie migration
dataset changed             -> replace that dataset only
user wants a translation    -> install that dataset only
```

Milestone: v0.4.3. This gets more expensive with every resource type added, so it lands before v0.5.0 feature work.

### D2. One resource descriptor, per-type storage

**Decision.** A universal `ResourceDescriptor` answers: what is this, where did it come from, may I use it, which version is installed, how do I manage it. It does not answer how content is stored.

```ts
interface ResourceDescriptor {
  id: string;
  type: ResourceType;     // translation | commentary | lexicon | dictionary |
                          // manuscript | patristic | topical-index | map | lectionary | audio
  title: string;
  author?: string;
  description?: string;
  language?: string;
  license: LicenseInfo;
  provenance: ProvenanceInfo;
  version: string;
}
```

Content stays in domain tables with domain indexes: translations in `verses`, commentaries in `commentaryEntries`, lexicons in `lexicon`, topics in `topics`. There will be no polymorphic `resources_content` blob table. The descriptor is the union of today's `Translation` record and the pipeline's `SourceDataset`, moved client-side.

Milestone: v0.5.0 as #51, pulled forward from v0.6.0 by D15 because commentary is the first non-translation type and needs it. The credits screen (#235) reads from it.

**Landed** (2026-09-24, #51): `ResourceDescriptor` in core with `LicenseInfo` and `ProvenanceSource[]`, a resource registry in the pipeline that builds descriptors from the source registry and accepted checksums, manifest format 2 with `resources[]` and a `resourceId` per dataset, and the Dexie `resources` table (v33). The translation catalog record is derived from the resource, so `Translation` keeps its reader-facing fields plus a `resourceId`. See [data-architecture.md](data-architecture.md) section 2.4.

### D3. Three storage classes with different lifecycles

| Class | Tables | Lifecycle |
|---|---|---|
| System data | verses, translations, entities, crossrefs, lexicon, topics, resources | downloadable, replaceable, versioned, rebuildable |
| User data | annotations, tags, savedSearches, settings, kv | never silently deleted, exportable, syncable, migrated carefully |
| Plugin data | one IndexedDB database per plugin | namespaced, logically quota-limited, deleted on uninstall with confirmation |

This is already true in the code, where only five tables are user-writable. Writing it down makes it a rule.

### D4. One IndexedDB database per plugin, with logical quotas

**Decision.** Plugin state lives in `codex-plugin-<id>`, never in the core database. Uninstall is `deleteDatabase`. Plugin schemas never couple to core migrations.

**Nuance.** Browser quota is per origin, not per database, so separate databases give schema and lifecycle isolation, not physical quota isolation. Codex imposes logical quotas itself: every plugin write goes through a `PluginStorage` API that measures the serialized payload and refuses writes past policy. `navigator.storage.estimate()` still reports origin-wide pressure. Plugins never receive a raw Dexie handle.

**Multi-tab.** Deleting a database is blocked while another tab holds it open. This is solved once, centrally: uninstall broadcasts a close request over `BroadcastChannel`, every plugin connection closes on `versionchange`, then `deleteDatabase` runs. If a tab refuses, the user sees "Codex Scriptura is open in another tab. Close it and retry", not a silent failure.

### D5. `.csdata` is the universal resource package, with two transports

**Decision.** Built-in datasets and externally installed ones use the same package format, so the seven translations and the shared datasets are bundles served from the origin, and the on-demand installer is the `.csdata` installer. One code path, dogfooded from day one.

The logical package is separate from the transport:

```
.csdata logical package
  manifest.json           ResourceDescriptor + file list + hashes
  payload files           per-type JSON, chunked
```

```ts
interface PackageSource {
  readManifest(): Promise<ResourceManifest>;
  openFile(path: string): Promise<ReadableStream<Uint8Array>>;
}
```

`HttpPackageSource` reads a manifest plus independently hosted chunks, which is what first boot does today. `ZipPackageSource` reads a sideloaded or marketplace archive through a streaming reader. Both feed the same validator and importer. This keeps first boot from downloading and decompressing one giant archive, which would make the seeding memory peak (#168) worse.

`.csdata` means "portable Codex resource package". It does not mean "plugin".

### D6. Identity is trusted from the manifest, verification is for untrusted input

Same-origin first-party content: the pipeline hashes each logical dataset before splitting, the manifest carries the hash, the browser stores it as identity without re-hashing 146 MB on first boot.

External `.csdata`: validate the manifest, stream files, verify hashes, and eventually verify a publisher signature, before import. The threat model changes the moment content arrives from anywhere other than the deploy.

### D7. Plugin trust tiers, one API, different transports

| Tier | Executes code | Runs | Talks to Codex via |
|---|---|---|---|
| Resource package | no | installer | n/a |
| Trusted first-party plugin | yes | in-process | direct async calls to the Plugin API implementation |
| Sandboxed third-party plugin | yes | worker, iframe | RPC proxy to the same Plugin API implementation |

**Hard invariant.** A first-party plugin gets lower transport overhead. It does not get more conceptual capability because it lives in this repo. Any privileged capability is declared as such in the API, never taken as an internal shortcut. Otherwise there would be a real internal API and a crippled public one, and the public one would never be dogfooded.

**Consequence.** The public API is serializable and asynchronous from its first version, even while the only implementation is in-process. No DOM nodes, no live objects, no arbitrary CSS classes cross the boundary. Plugins express intent, Codex renders. See [plugin-api.md](plugin-api.md).

### D8. Plugins register views and panels, not routes

URL patterns are core infrastructure. Plugins call `registerView` and `registerPanel` against semantic extension points, and Codex assigns the URL under `/plugins/<id>`. There is no `registerRoute`.

### D9. No repository classes yet

The `db` package already is the data-access boundary. It has one implementation, so an interface would be ceremony. The fix for its 1,372-line file is a split by domain (`verses.ts`, `cross-references.ts`, `entities.ts`, `annotations.ts`, `resources.ts`, `settings.ts`, `datasets.ts`), not a class hierarchy. When workers arrive there will be a second implementation, an RPC proxy, and that is when a `ScriptureStore` interface earns its existence.

### D10. Workers for computation, the pipeline for stable aggregates

Moving IndexedDB-bound work to a worker moves the waiting, nothing else. The graph's problem is an N+1 access pattern, fixed by a better query plan and by precomputing at build time.

**Rule.** If a computation depends only on immutable seeded data and produces a stable result, compute it in the pipeline. Runtime computation exists for things that depend on user state, the selected passage or translations, interactive traversal, or plugin data.

Workers are justified today for MiniSearch index builds, concordance scans, divergence, seed parsing and, eventually, expensive graph layout. Graph retrieval is not graph layout. Issues #38 (build-time aggregates) and #167 (graph query plan) are one design and move together.

### D11. The package tree stays boring

No package has a build step, so a new workspace package is cheap to create and expensive to enforce. A directory becomes a package when there is a concrete reason: a different runtime, a different dependency graph, an independent build target, reuse across applications, a security boundary, a worker bundle, or SDK distribution. `search` splits out when a worker bundle needs it without Svelte. The app moves to `apps/web` when a second app exists, which is the desktop wrapper at v1.0.0. `reader` stays inside the app.

### D12. Milestone reshuffle

*The milestone bullets and the commentary paragraph below are the 2026-09-16 record and are superseded by D15. The three forms of extensibility and the backend principle stand.*

The first extensibility release executes zero third-party JavaScript.

- **v0.4.3** is retitled **Data Lifecycle & Performance**: the `datasets` table (#310) and pipeline dataset manifest (#311) for D1, the db package domain split (#320, D9), importer validation hardening (#321), and #38 linked to #167, alongside the search and seeding items already there.
- **v0.5.0 Manuscript & History** keeps its name and gains user-data durability: backup and import (#60, #61, #277) pulled forward from v0.8.0, annotation editing in place (#322) and tag management (#323). Sync can wait; protecting irreplaceable user data cannot, and the export format is what sync later encrypts.
- **v0.6.0** becomes **Resource Ecosystem**: `ResourceDescriptor` (#51), the `.csdata` specification with both package sources, validator, installer and Resource Manager (#52), first-party datasets converted to resource packages (#312), credits reading from descriptors (#235), commentary as the first non-translation resource type (#82, #83, #85) with narrowly scoped commentary search (#86), dictionaries (#155, #191) and topical Bibles (#156, #190) as packs, the Church Fathers corpus as a resource (#42), a SWORD Bible-module importer bringing Douay-Rheims 1899 and the Catholic Public Domain Version in as packages (#141), and licensed remote translation support (#316, D14). This is the milestone where Codex changes from an app with several hardcoded datasets into a study platform with a coherent resource system.
- **v0.7.0 Scholar Features** keeps its name and gains Reading with the Fathers (#84) and citation integration (#87), which are scholarly workflows over the resources rather than prerequisites for them.
- **v0.8.0 Migrate & Sync** narrows to actual sync and migrations now that backup exists earlier: encryption, Drive app-data, multi-device merge, tombstones, then Dropbox and the Logos, Accordance and e-Sword importers.
- **v0.9.0** is retitled **Public Beta & Reliability**. It was already the beta-readiness milestone, so the provider integrations land there: Crossway ESV (#317) and API.Bible (#318), the credential proxy, FUMS and licensing UX, quota monitoring, plus mobile, accessibility, onboarding, performance, workers and real-user validation. The question it answers is whether Codex can safely go in front of hundreds of people.
- **v1.0.0 Launch** no longer gates on the plugin API. The gate is in [release-process.md](release-process.md). #78 moved out, and #80 now covers only the documentation site; the plugin registry belongs with the marketplace (#100, v1.4.0).
- **v1.1.0** is **Executable Plugin Runtime**, replacing the old Commentary Framework milestone, which was dissolved once its issues were rehomed. It holds the sandbox (#53), the first executable first-party plugins (#54) and API finalization (#78), with its own stability target: the API is versioned and no breaking change ships without a major bump.
- **v1.2.0 onward** stay as they are: product expansion, then the community backend at v1.4.0.

**Three forms of extensibility, kept apart.**

```
1. Resource extensibility            v0.6.0
   .csdata, no executable code
   translations, commentaries, dictionaries, topics, Fathers

2. Licensed remote resources         v0.9.0
   provider-backed content
   stateless credential infrastructure where required

3. Executable extensibility          v1.1.0 and later
   Plugin API, trusted first-party, sandboxed third-party
   marketplace-ready behaviour, distribution at v1.4.0
```

**Backend principle, restated.** Codex does not introduce a stateful user-data backend until features involving shared or community state require one. Stateless infrastructure required to protect third-party credentials or access licensed resources is permitted earlier (D13). Any wording elsewhere that says "no backend until v1.4" is superseded by this sentence.

This milestone spine is considered stable as of 2026-09-16. Boundaries move only when implementation or beta-user evidence forces it.

**Why commentary moved to v0.6.0 rather than earlier.** Commentary is a v1-relevant study capability. Its implementation waits for the Resource Ecosystem so it is built once against the permanent commentary resource model rather than through a temporary bespoke path that would then be migrated. Its importance did not change; its dependency ordering did. This is the same reasoning that closed #48 in August.

### D13. Stateless infrastructure may precede the community backend

**Amends** the first principle's cloud clause and the sync design's "no backend before community features".

Licensed translation providers forbid publishing their API keys (Crossway: "you may not sell, share, or publish your access key"; API.Bible section 12). Serving those translations therefore needs something server-side that holds the key.

**Decision.** Codex may operate stateless infrastructure before the community backend when required to securely access a licensed third-party service. Such infrastructure:

- stores no user study data,
- does not create Codex accounts,
- exists only to protect credentials and enforce provider access rules,
- does not become part of the core offline study path.

Concretely, a Cloudflare Worker per provider that forwards passage requests with the key attached. Because every Codex user shares one provider quota through it, quota observability and rate limiting are requirements, not operational afterthoughts: aggregate request counts, provider quota headers, error rates and rate-limit state per provider, without logging passage-reading histories. If provider quotas make a public beta uneconomic, that is discovered here before users depend on the resource.

Not every provider needs this. YouVersion offers client SDKs with their own security model; follow the provider's intended model rather than assuming one proxy design fits all.

### D14. Licensed translations: the TranslationSource seam and capability defaults

**Context.** Modern translations are not distributable offline. Verified 2026-09-16: ESV allows at most 500 verses or half a book stored locally and 5,000 requests per day; API.Bible requires cached content refreshed within 30 days, FUMS usage reporting for web apps, and caps NKJV at 5,000 monthly end users on non-commercial plans. Codex supports both delivery modes rather than choosing.

**The seam is justified now.** D9 said no repository interface until a second implementation exists. A concrete second implementation is now committed and specified, so introducing the seam is justified: the reader loads through three calls, `getBookList`, `getChapterList`, `getChapter`; today they have one implementation over IndexedDB, and the licensed-remote implementation over provider adapters (#316) is the second. That interface is `TranslationSource`. A generic `Repository<T>` is still not justified.

**Delivery on the descriptor.** A resource is either `local` (a `.csdata` package, fully offline) or `licensed-remote` (a provider, a policy, offline false or limited). The policy carries `cacheBudgetVerses`, `refreshWithinDays`, and capability flags: display, persistentOffline, fullTextSearch, concordance, derivedAlignment, exportText.

**Every derived capability defaults to false.** A licensed translation ships with display and chapter navigation only. Each further capability is enabled per translation only when the applicable license explicitly permits it. Display rights do not imply the right to download the whole text, build a search index, derive alignment, attach Strong's, persist every chapter, export, or ship it through `.csdata`. Those are materially different uses.

**Unsupported capabilities never fail silently.** A translation without full-text search does not appear in the search multi-select. Word Study explains that original-language alignment is not available for that translation. Export omits it with a notice. The Translation Manager shows the delivery mode and what is permitted.

**Provider usage reporting is not Codex analytics.** Codex Scriptura does not operate general behavioural analytics. Some licensed resource providers may require narrowly scoped usage reporting as a condition of displaying their content. Such reporting is limited to views using that provider and is disclosed alongside the resource's licensing and privacy information.

Public-domain translations such as Douay-Rheims and the CPDV do not need any of this; they are ordinary local resources. The Majority Standard Bible (#152, CC0) remains the modern-English option that gets the full local capability set.

Issues: #316 (seam, policy, defaults, degradation), #317 (Crossway ESV), #318 (API.Bible), #141 (SWORD importer).

### D15. Milestone shape, revised 2026-09-17

**Supersedes** the milestone bullets in D12. The three forms of extensibility, the backend principle and D13 are unchanged.

**Context.** Working the v0.4.3 through v1.3.0 issues into full specifications showed three things in the wrong milestone: commentary was waiting on the resource ecosystem it does not need, an activity engine and several UI-style plugins were sitting in the resource milestone, and v0.5.0 had grown into "everything related to manuscripts and history" rather than the study workflow the product needs next.

**The shape.**

- **v0.4.3 Data Lifecycle & Performance.** As in D12, plus the search route split (#364) and a release-time documentation truth check (#361). The search design is settled without a `SearchService`: engines are plain modules under `src/lib/search/`, one MiniSearch index per translation indexes raw terms and stems, the concordance queries the stem exactly (#164), Strong's gets a pipeline-emitted inverted index that is a derived dataset of its translation (#166, `derivedFrom` in the manifest, #311). Morphology follows the Strong's shape when its data exists (#32).
- **v0.5.0 Core Study** (renamed from Manuscript & History). Commentary MVP in the Study Rail (#366, with the content model #83 and public-domain importers #85), `ResourceDescriptor` pulled forward (#51), backup hardening on the format that shipped in v0.4.2 (#365), annotation editing (#322) and tag management (#323), word study on tap and full lexicon entries (#128, #154), footnotes (#39), the BSB alignment rebuild (#151), search within annotations (#47), credits and licenses (#235), granular clears (#277), and the PaneState and reader decompositions that commentary integration requires (#362, #363). The manuscript and history items moved to v0.7.0; audio pronunciation, notable objects, Story Mode and the BibleData Things import are parked.
- **v0.6.0 Resource Ecosystem.** Purely resources. The `.csdata` logical package format and `PackageSource` contract (#52), verification of external packages (#368), the Resource Manager (#367), first-party datasets delivered as packages through the same installer (#312), Nave's as the first conversion (#190), dictionaries (#191, #155), topical Bibles (#156), the Church Fathers corpus as a resource (#42), the SWORD importer (#141), the Majority Standard Bible (#152), translation expansion (#40), commentary search (#86) and the licensed remote seam (#316). Nothing here executes third-party code and nothing here is an activity feature.
- **v0.7.0 Scholar Features.** Gains from v0.5.0: morphology search (#32), interlinear (#35), timeline (#36), provenance and competing claims (#37), Manuscript Explorer (#41), book metadata (#43, #45) and the Berean Greek texts (#153), alongside Reading with the Fathers (#84), Reception History (#202) and the trackers (#57, #58).
- **v0.8.0, v0.9.0.** Unchanged from D12. **v1.0.0** gained its launch features in D16.
- **v1.1.0 Executable Plugin Runtime.** Sandbox and workers (#53), API finalization (#78), the plugin-safe categorical ramp with slot allocation (#260, a prerequisite of #195), and the proving trio in #54: speaker highlighting (#195, semantic verse decoration), the units converter (#196, lightweight interactive UI) and vocab drills (#197, Worker, permissions and plugin storage). Structure overlays (#199) and the export pack (#201) are parked until a demonstrated gap after the trio ships; each would otherwise grow the base runtime a margin-decoration surface or action registration. Gospel harmony (#198) was parked here for the same reason (a pane-control API) and left the plugin track in D16.
- **v1.3.0 Devotional & Journaling.** Holds the whole activity chain: the Reading Logs Engine (#56), then reading plans as its first consumer (#93), then the contribution graph (#55) and stats dashboard (#200) as secondary visualizations. Sharing in #93 is portable plan exchange; hosted discovery is #101 on v1.4.0.

```
v0.5.0 Core Study                 commentary, word study, lexicons, footnotes,
                                  annotations, BSB alignment, descriptor
        |
        v
v0.6.0 Resource Ecosystem         package format, installer, manager,
                                  more translations and content
        |
        v
v0.7.0 Scholar Features           morphology, interlinear, manuscripts,
                                  provenance, timeline, scholar workflows
```

**Why commentary moved to v0.5.0** (reversing D12). Commentary is part of the fundamental study loop, and the display primitive belongs in core regardless of how content arrives. It is not built twice: #83's content model is required to be expressible as a `.csdata` payload, so v0.6.0 repackages it (#312) rather than rewriting it. D12's build-once argument assumed the whole resource model had to exist first; the descriptor (#51) is the only part commentary needs, and it moved with it.

**Why the UI-style plugins are not built as core features first.** Building speaker highlighting in core at v0.6.0 and extracting it to the Plugin API at v1.1.0 builds it twice. Unlike commentary, these are optional capabilities: Codex is coherent without them, which is what first-party executable plugins are for.

**Why the activity engine is not pulled forward.** An append-only reading log with no consumer is telemetry-shaped infrastructure. It lands with reading plans, the first feature that needs daily progress, under the same rule that rejects every other abstraction in this document.

This milestone spine is considered stable as of 2026-09-17.

### D16. v1.0.0 gets a launch thesis and a headline, 2026-09-20

**Amends** the v1.0.0 line in D12 and D15. Everything else in D15 stands.

**Context.** After D12 moved the plugin API to v1.1.0, v1.0.0 held boolean search (#81), the documentation site (#80) and the desktop wrapper (#79). The gate in [release-process.md](release-process.md) is a stability statement, which is right, but a user going from v0.9.0 to v1.0.0 would have seen nothing new. A launch needs something to show.

**Thesis.** Launch means Codex is ready for general readers, and the entity, event and place data it has accumulated gets a front door they can use. Every milestone before it serves the scholar first.

**What moved.**

- **Story Mode (#50)**, from the parking lot. The headline: curated narratives stepped through in the reader, with people, places and events following each step. User-created narratives are deferred (#381, parked).
- **Biblical atlas (#106)**, from v2.0.0, narrowed to an offline vector basemap and the places of the active chapter. The coordinates are already imported and enriched, and the map button in `EntityDetailPanel` is a stub today. Archaeological and historical layers stay on v2.0.0 (#382).
- **Gospel harmony viewer (#198)**, from the parking lot. A harmony dataset plus a panel that drives split-view panes.

**Why this does not reopen D15's build-twice argument.** D15 parked #198 because, as a plugin, it would force a pane-control API into the base runtime, and it refused to build optional plugins in core only to extract them later. Story Mode and the harmony viewer are core features with no planned extraction: both are a first-party dataset plus a navigator over the existing reader, and both drive panes through their public navigation. Nothing is built twice and the v1.1.0 runtime gains no surface because of them. Their datasets ship through the same lifecycle as every other first-party dataset (#310, #311, #312).

**Why not reading plans.** They are the obvious general-reader feature, but D15's reasoning holds: the activity chain (#56, #93, #55) lands together on v1.3.0.

**Constraints carried into the issues.** None of the three may grow `PaneState` (#362), the story picker stays out of the reader bar, and all three work fully offline with no third-party map SDK or tile server.

### D17. Canonical references are independent of translation datasets, 2026-09-24

**Context.** A topic reference to Deuteronomy 7:9 followed with OEB active landed on a dead "No verses found" screen (#400), and a new split pane could open on OEB for a Genesis comparison (#404). Both came from the same missing distinction: a reference was treated as something a translation either has or does not, rather than as a fact about the study data that any installed translation may or may not be able to render.

**Invariant.** Canonical scripture references are independent of translation datasets. Whether a translation can render a reference is a capability query over the installed resources, answered from the data on the device, never from the reference itself.

**Consequences.**

- Three concepts stay distinct, in this order: the canonical reference, translation capability (installed and holds the book), candidate ranking (the stored preference, then KJV, then catalog order), and the effective translation. `utils/translationSelection` is the one place the filter and the ranking live; `translationLibrary.installedCoverage()` is the one capability source.
- The effective translation is never the preferred one by implication. Only an explicit choice in the picker or Settings writes the preference (#401, `utils/activeTranslation`); a boot-time fallback, an empty-state offer or a split-pane pick does not.
- A split pane opens on a compatible translation that is already in use before it refuses: compatibility first, uniqueness second, source-pane affinity third. Two panes on the same translation compare nothing and still read. Opening fails only when no installed translation contains the passage.
- No caller special-cases a translation ("skip OEB for Genesis"). Partial canons, user-supplied datasets and licensed translations with capability limits (D14) all go through the same query.

## Open questions

- Publisher signing format for third-party `.csdata` and plugins. Needed before the marketplace at v1.4.0, not before. #368 reserves the manifest block and validator hook.
- Whether logical plugin quotas are fixed per plugin or declared in the manifest and approved at install.
- The `commentaryEntries` shape, now being decided in #83 (v0.5.0). It should serve commentaries, study notes and patristic citations (#202) alike since all three are verse-keyed.
