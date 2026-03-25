# Local Development & Data Seeding

Codex Scriptura is offline-first. To develop locally, you need to seed your browser's IndexedDB with Bible data. We do this by extracting raw, large XML datasets into optimized JSON chunks that the SvelteKit app fetches on first load.

## 1. Directory Structure
Ensure you have the following source texts in `data/texts/`:
- `eng-kjv.osis.xml`
- `eng-oeb.osis.xml`
- `eng-web.usfx.xml`

## 2. Running the Data Pipeline
We have `Node.js` scripts in `packages/data-pipeline` that parse OSIS and USFX XML structures.

```bash
cd packages/data-pipeline
pnpm run import:all
```
This script will:
1. Parse the milestones or container elements from the XML.
2. Strip out nested XML, footnotes, and unnecessary tags.
3. Map USFM book codes (e.g., `GEN`) or OSIS IDs (e.g., `Gen`) to our canonical 81-book mapping.
4. Output three JSON files (`kjv-verses.json`, `oeb-verses.json`, `web-verses.json`) into the `static/data/` folder of the SvelteKit app.

## 3. Client-Side Seeding
When you start the dev server (`pnpm dev`) and load `http://localhost:5173`, the `seed.ts` script runs:
1. It loops through the translation manifests.
2. If `isTranslationSeeded` returns false, it fetches the corresponding JSON from the `/data/` static route.
3. It uses Dexie.js `bulkPut` to insert all verses into your browser's IndexedDB in a single transaction.

*Tip: If you need to re-seed during development (e.g., you updated the Dexie schema), open Chrome DevTools → Application → Storage → Clear site data.*
