# Local Development & Data Seeding

Codex Scriptura is offline-first. To develop locally, you need to seed your browser's IndexedDB with Bible data. The data pipeline downloads public-domain source files, parses them into optimized JSON, and copies them to `static/data/` where the SvelteKit app can serve them.

## Quick Start (one command)

After cloning and running `pnpm install`, run:

```bash
pnpm setup:data
```

This single command will:
1. **Download** Bible text XMLs (KJV, OEB, WEB) and Theographic metadata CSVs from their public-domain sources.
2. **Parse** OSIS and USFX XML into verse JSON files.
3. **Import** Theographic CSVs (people, places, events, dictionary).
4. **Enrich** places with OpenBible geocoding and persons with BibleData name meanings.
5. **Copy** all processed JSON into `static/data/` for the dev server.

> **No manual file downloads needed.** All source data is fetched automatically from public repositories.

## Running Individual Steps

If you only need to re-run part of the pipeline:

```bash
cd packages/data-pipeline

# Bible texts only
pnpm run setup:texts       # fetch XMLs + parse into JSON

# Theographic metadata only
pnpm run setup:theographic # fetch CSVs + import

# Enrichment only (requires theographic data)
pnpm run setup:enrichment  # fetch external data + merge

# Copy processed JSON to static/
pnpm run copy
```

## What the Pipeline Does

The `Node.js` scripts in `packages/data-pipeline` parse OSIS and USFX XML structures:
1. Parse the milestones or container elements from the XML.
2. Strip out nested XML, footnotes, and unnecessary tags.
3. Map USFM book codes (e.g., `GEN`) or OSIS IDs (e.g., `Gen`) to our canonical 81-book mapping.
4. Output JSON files into `data/processed/`, then copy to `static/data/`.

## 3. Client-Side Seeding
When you start the dev server (`pnpm dev`) and load `http://localhost:5173`, the `seed.ts` script runs:
1. It loops through the translation manifests.
2. If `isTranslationSeeded` returns false, it fetches the corresponding JSON from the `/data/` static route.
3. It uses Dexie.js `bulkPut` to insert all verses into your browser's IndexedDB in a single transaction.

*Tip: If you need to re-seed during development (e.g., you updated the Dexie schema), open Chrome DevTools → Application → Storage → Clear site data.*
