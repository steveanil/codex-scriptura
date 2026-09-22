import path from 'node:path';
import { buildStrongsIndex } from './importers/build-strongs-index.js';
import { DATASETS } from './core/dataset-registry.js';
import { dataDir } from './core/paths.js';

/**
 * Build the Strong's postings of every tagged translation (issue #166).
 *
 * Input:  data/processed/<id>-verses.json for each `strongs` translation
 * Output: data/processed/strongs-index-<id>.json
 *
 * Runs in `import:all` after the last step that writes lemmas (the WEB
 * derivation), so the postings always describe the verses they ship with.
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && npx tsx src/build-strongs-indexes.ts
 */

const processed = path.join(dataDir, 'processed');
for (const def of DATASETS) {
    const source = DATASETS.find((d) => d.id === def.derivedFrom);
    if (!source?.translation?.strongs) continue;
    const { postings, bytes, largest } = buildStrongsIndex(path.join(processed, source.file), path.join(processed, def.file));
    console.log(`[strongs-index] ${source.translation.id}: ${postings} postings, ${(bytes / 1024 / 1024).toFixed(2)} MB, largest ${largest?.strongsId} (${largest?.osisIds.length} verses)`);
}
