# Local Development & Data Seeding

Codex Scriptura is offline-first. To develop locally, you need to seed your browser's IndexedDB with Bible data. The data pipeline downloads public-domain source files, parses them into optimized JSON, and copies them to `static/data/` where the SvelteKit app can serve them.

## Quick Start (one command)

After cloning and running `pnpm install`, run:

```bash
pnpm setup:data
```

This single command will:
1. **Download** the seven translations (KJV, WEB, OEB, ASV, BSB, YLT, DBY), the original-language texts the WEB Strong's tagging is derived from, and the Theographic metadata CSVs, verifying pins and checksums.
2. **Parse** OSIS and USFX XML into verse JSON files, derive the WEB Strong's numbers, build the per-translation Strong's postings, and validate the corpus (hard errors stop the run).
3. **Import** Theographic CSVs (people, places, events, dictionary).
4. **Enrich** places with OpenBible geocoding and persons with BibleData name meanings.
5. **Import** cross-references (OpenBible/TSK + typed overlays) and their build-time aggregates, genealogy relationships, the Strong's lexicon (Hebrew + Greek) and Nave's topics.
6. **Copy** every dataset into `static/data/`, splitting large files, and write `static/data/manifest.json` with each dataset's version and content hash.

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

# Cross-references (OpenBible + typed overlays)
pnpm run setup:crossrefs

# Genealogy relationships
pnpm run import:genealogy

# Strong's lexicon (Hebrew + Greek)
pnpm run setup:lexicon

# Nave's topical index
pnpm run setup:naves

# Copy processed JSON to static/ and write the manifest
pnpm run copy
```

## What the Pipeline Does

The `Node.js` scripts in `packages/data-pipeline` parse OSIS and USFX XML structures:
1. Parse the milestones or container elements from the XML.
2. Strip out nested XML, footnotes, and unnecessary tags.
3. Map USFM book codes (e.g., `GEN`) or OSIS IDs (e.g., `Gen`) to our canonical 81-book mapping.
4. Output JSON files into `data/processed/`, then copy to `static/data/`.

## Client-Side Seeding
When you start the dev server (`pnpm dev`) and load `http://localhost:5173`, `src/lib/seed.ts` runs:
1. It fetches `/data/manifest.json`, which lists every dataset with a version and a content hash.
2. It installs the active translation (KJV on a fresh profile) and opens the reader, then streams the shared datasets in behind it. Each dataset is compared with its receipt row in the `datasets` table and installed only when missing or stale, one split file per transaction; the receipt is written last, so an interrupted install simply restarts next boot.
3. The other translations download on demand from Settings > Library.

A dataset you regenerate with the pipeline reinstalls on its own at the next load, because its manifest version changes.

*Tip: to test a first boot from scratch, open Chrome DevTools → Application → Storage → Clear site data. The dev service worker serves stale modules; block or unregister it when testing in a browser (see `.claude/skills/verify`).*
