# Plugin API (Draft Stub)

> **Note:** The Plugin API is currently in the design phase (Targeting v0.6.0). This document serves as a stub to illustrate the developer-facing contract, message-passing boundaries, and hook signatures for future contributors.

## 1. The Plugin Manifest (`plugin.json`)

Every plugin must define a manifest declaring its name, version, and the capabilities it requests from the core SvelteKit application. This ensures users know exactly what a plugin is doing with their data.

```json
{
  "id": "org.codexscriptura.example-votd",
  "name": "Verse of the Day",
  "version": "1.0.0",
  "description": "Displays a daily verse in the sidebar.",
  "author": "Codex Core Team",
  "entrypoint": "dist/index.js",
  "capabilities": [
    "ui:sidebar",        // Can mount a Svelte/HTML component in the sidebar
    "read:verses",       // Can query Dexie for verse text
    "write:annotations"  // Can create highlights/notes (requires explicit consent)
  ]
}
```

## 2. The Hook API

Plugins interact with the core application by registering callbacks to specific lifecycle and user-action hooks. The core app ensures strict typings for these boundaries.

### `onVerseRender(context, next)`
Fired when a chapter or set of verses is rendered in the main reading pane. Essential for Overlay plugins (e.g., interlinear views, syntax highlighting, or entity tooltips).

```typescript
interface VerseRenderContext {
  verseId: string;       // e.g., "John.3.16"
  translationId: string; // e.g., "WEB"
  text: string;          // The raw text content
  domNode: HTMLElement;  // The container node for this verse
}

// Example: highlighting specific words in the DOM
codex.hooks.onVerseRender((ctx) => {
  if (ctx.text.includes("grace")) {
    // Note: Core DOM manipulation rules will enforce non-destructive edits
    ctx.domNode.classList.add('plugin-highlight-grace');
  }
});
```

### `onSearchResult(context)`
Fired when MiniSearch resolves a query. Allows plugins to inject reference materials or re-rank results based on their own datasets.

```typescript
interface SearchResultContext {
  query: string;
  results: Array<{
    verseId: string;
    score: number;
    matchTerms: string[];
    preview: string;
  }>;
}

// Example: Injecting dictionary definitions above search results
codex.hooks.onSearchResult((ctx) => {
  if (ctx.query === "baptize") {
    codex.ui.injectTopResult({
      title: "Strong's G907 (βαπτίζω)",
      preview: "to dip repeatedly, to immerse, to submerge..."
    });
  }
});
```

### `onPanelMount(context)`
Fired when the user explicitly opens a plugin's authorized UI panel (e.g., a commentary tab in the sidebar).

```typescript
interface PanelContext {
  panelId: string;
  container: HTMLElement; // The DOM element where the plugin mounts its UI
  state: any;             // Persisted plugin state passed from Core Dexie
}

codex.hooks.onPanelMount((ctx) => {
  // Mount a Svelte, React, or Vanilla JS app into the strictly bound container
  new MyPluginUI({ target: ctx.container, props: { state: ctx.state } });
});
```

## 3. Sandboxing & Message Passing

To ensure security, data integrity, and prevent UI thread blocking:
1. **Data Plugins** (heavy processing) run inside **Web Workers**.
2. **UI Plugins** run inside managed DOM nodes or **sandboxed iframes** depending on the requested capabilities.

Communication between the plugin and Codex Core happens via a typed, asynchronous Remote Procedure Call (RPC) message bus. Plugins cannot access `window.indexedDB` directly; they query the core via `codex.db`.

```typescript
// Plugin requesting data from Core
const targetVerse = await codex.db.query('verses', { 
  book: 'Gen', 
  chapter: 1, 
  verse: 1 
});

// Plugin requesting a Core UI action
await codex.commands.execute('navigate', { osisId: 'Gen.1.1' });
```

## 4. Lifecycle Methods

Plugins must export a standard lifecycle object from their `entrypoint`.

```typescript
export default {
  /**
   * Called exactly once when the plugin is installed or enabled by the user.
   * Safe to initialize local state or fetch initial plugin-specific data.
   */
  async activate(api: CodexAPI) {
    console.log("Plugin activated");
    api.hooks.register('onVerseRender', myRenderHook);
  },

  /**
   * Called when the plugin is disabled or uninstalled.
   * Must clean up all DOM event listeners, intervals, and unregister hooks.
   */
  async deactivate(api: CodexAPI) {
    api.hooks.unregisterAll();
  }
}
```

## 5. CSS Variable Sandboxing

Plugins can hook into the global `UserPreferences` CSS Custom Property engine to achieve native theming without additional API surface. However, to prevent global style pollution, **plugins must strictly namespace their CSS variables.**

```css
/* BAD: Overwrites core theme and breaks the app UI */
:root { --color-accent: red; }

/* GOOD: Namespaced cleanly via plugin ID */
:root { --plugin-maps-water-color: blue; }
```
When a user changes their base theme (e.g., light to dark mode), SvelteKit proxies the core variables, and well-behaved plugin variables will cleanly inherit the environment.

## 6. Data Bundles (`.csdata`)
*Targeting v0.6.0+*

For plugins that consist purely of datasets (Church Fathers, commentaries, lexicons), Codex Scriptura uses a consistent distribution format: the `.csdata` bundle. This is a compressed archive containing a manifest and structured JSON data files.

**Example `manifest.json` inside a `.csdata` bundle:**
```json
{
  "schemaVersion": "1",
  "bundleType": "commentary-pack",
  "id": "matthew-henry",
  "name": "Matthew Henry Commentary",
  "version": "0.1.0",
  "author": "Public Domain",
  "dependsOn": [],
  "contents": [
    { "type": "commentary", "path": "commentary.json" }
  ]
}
```
Defining this early gives the plugin marketplace a first-class artifact type, preventing developers from inventing ad-hoc file shapes for raw text data.
