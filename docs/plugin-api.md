# Plugin API (Draft)

> **Status:** design only. Nothing here is implemented. The `packages/plugin-api` package is a stub. The decisions this draft follows are recorded in [architecture-decisions.md](architecture-decisions.md), D5 to D8. The first extensibility milestone ships resource packages, not executable plugins; see section 6.

## 1. Three kinds of extension

| Kind | Executes code | Example | Ships in |
|---|---|---|---|
| Resource package (`.csdata`) | no | Matthew Henry, Church Fathers corpus, a lectionary, a dictionary | v0.6.0 Resource Ecosystem |
| Trusted first-party plugin | yes, in-process | Scripture Graph, Genealogy Explorer, Timeline | Plugin Runtime milestone |
| Sandboxed third-party plugin | yes, in a worker or iframe | anything installed from outside the repo | Plugin Runtime milestone |

Both plugin tiers call the same API. A first-party plugin calls it directly. A third-party plugin calls it through an RPC proxy. The API is therefore asynchronous and serializable from its first version, even while every implementation is in-process. A first-party plugin never gets a capability the API does not declare.

## 2. The manifest (`plugin.json`)

```json
{
  "id": "org.codexscriptura.scripture-graph",
  "name": "Scripture Graph",
  "version": "1.0.0",
  "description": "Canon ring and neighborhood views over cross-references.",
  "author": "Codex Core Team",
  "entrypoint": "dist/index.js",
  "capabilities": [
    "scripture:read",
    "entities:read",
    "ui:view",
    "ui:panel",
    "storage:plugin"
  ]
}
```

Capabilities are granted at install. `annotations:write` always requires explicit user consent. There is no capability that grants raw database access.

## 3. The API surface

Everything returns a promise. Every argument and result is structured-clone safe.

```ts
interface CodexAPI {
  scripture: {
    getVerse(translationId: string, osisId: string): Promise<Verse | null>;
    getPassage(translationId: string, ref: PassageRef): Promise<Verse[]>;
    getCrossReferences(osisId: string): Promise<CrossReference[]>;
  };
  entities: {
    getPeople(query: EntityQuery): Promise<Person[]>;
    getPlaces(query: EntityQuery): Promise<Place[]>;
    getEvents(query: EntityQuery): Promise<BibleEvent[]>;
  };
  resources: {
    list(type?: ResourceType): Promise<ResourceDescriptor[]>;
    query(resourceId: string, query: ResourceQuery): Promise<ResourceHit[]>;
  };
  annotations: {
    read(query: AnnotationQuery): Promise<Annotation[]>;
    write(annotation: NewAnnotation): Promise<string>;   // capability: annotations:write
  };
  navigation: {
    openReference(osisId: string, options?: { pane?: number }): Promise<void>;
  };
  ui: {
    registerView(view: ViewRegistration): Promise<void>;
    registerPanel(panel: PanelRegistration): Promise<void>;
  };
  storage: PluginStorage;
  hooks: {
    onVerseRender(handler: (ctx: VerseRenderContext) => Promise<VerseDecoration[]>): void;
    onSearchResult(handler: (ctx: SearchResultContext) => Promise<SearchAugmentation>): void;
    unregisterAll(): void;
  };
}
```

`resources.query` takes a type-specific query shape. A commentary query is verse-keyed, a lexicon query is Strong's-keyed, a topical query is term-keyed. The descriptor is uniform; the content query is not.

## 4. Hooks express intent, Codex renders

### `onVerseRender`

Fired when verses are rendered in a pane. The handler receives text and identifiers and returns decorations. It never receives a DOM node.

```ts
interface VerseRenderContext {
  osisId: string;
  translationId: string;
  text: string;
  paneIndex: number;
}

interface VerseDecoration {
  range: { start: number; end: number };     // character offsets into text
  appearance: 'underline' | 'highlight' | 'emphasis';
  tone?: 'neutral' | 'info' | 'warning';
  tooltip?: string;
  actionId?: string;                         // dispatched back to the plugin on click
}
```

Arbitrary CSS classes are not accepted. Allowing them would couple plugins to private stylesheet internals, which is DOM access by another name.

### `onSearchResult`

Fired after a search resolves. The handler may re-rank or add a top card, using data only.

```ts
interface SearchResultContext {
  query: string;
  mode: 'fulltext' | 'concordance' | 'topics';
  results: Array<{ osisId: string; translationId: string; score: number }>;
}

interface SearchAugmentation {
  topCard?: { title: string; body: string; actionId?: string };
  reorder?: string[];                        // osisIds in the plugin's preferred order
}
```

## 5. Views, panels, and URLs

Plugins do not register routes. The reference URL scheme is core infrastructure.

```ts
interface ViewRegistration {
  id: string;                                // Codex assigns /plugins/<pluginId>/<id>
  title: string;
  icon?: string;
}

interface PanelRegistration {
  id: string;
  slot: 'study-rail';
  title: string;
}
```

A registered view or panel is rendered by the plugin's own code inside a container Codex owns. For a trusted plugin that container is a normal element in the app tree. For a sandboxed plugin it is an iframe, and the plugin's UI runs inside it with the same API reached over RPC.

## 6. Storage

```ts
interface PluginStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getUsage(): Promise<{ bytes: number; limit: number }>;
}
```

Backed by one IndexedDB database per plugin, named `codex-plugin-<id>`. Usage is a logical byte count of serialized payloads, not physical disk, and writes past the limit are refused. Uninstall closes connections in every tab, then deletes the database. Plugins never see `indexedDB` or Dexie.

## 7. Lifecycle

```ts
export default {
  async activate(api: CodexAPI) {
    api.hooks.onVerseRender(decorateGrace);
    await api.ui.registerView({ id: 'graph', title: 'Scripture Graph' });
  },
  async deactivate(api: CodexAPI) {
    api.hooks.unregisterAll();
  }
};
```

## 8. Theming

Plugins may read the core CSS custom properties and must namespace their own by plugin id (`--plugin-maps-water-color`). Writing to a core token is a violation and a sandboxed plugin cannot do it anyway.

## 9. Resource packages (`.csdata`)

A `.csdata` package is content plus metadata. It runs no code and needs no sandbox. It is the format for both built-in datasets and installed ones, so the seven translations and the shared datasets are `.csdata` packages served from the origin.

The logical package is separate from its transport:

```
manifest.json      ResourceDescriptor, file list, per-file hashes
verses/part-001.json
verses/part-002.json
```

```ts
interface PackageSource {
  readManifest(): Promise<ResourceManifest>;
  openFile(path: string): Promise<ReadableStream<Uint8Array>>;
}
```

`HttpPackageSource` reads independently hosted chunks, `ZipPackageSource` reads a sideloaded archive through a streaming reader, and both feed one validator and one importer. First-party packages are trusted by their manifest. External packages have every file hash verified before import, and a publisher signature once a marketplace exists.
