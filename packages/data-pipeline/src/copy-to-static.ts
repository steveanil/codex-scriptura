import path from 'node:path';
import { dataDir, staticDataDir } from './core/paths.js';
import { DATASETS } from './core/dataset-registry.js';
import { publishDatasets } from './core/dataset-manifest.js';
import { recordImportRun } from './core/import-runs.js';

/**
 * Publishes processed JSON from data/processed/ to static/data/ so SvelteKit
 * serves it at /data/*.json, and writes static/data/manifest.json describing
 * every dataset (issue #311). The published versions are appended to the
 * import-run ledger so a deploy can be traced back to its pipeline run.
 *
 * Run from repo root:
 *   cd packages/data-pipeline && npx tsx src/copy-to-static.ts
 */

const srcDir = path.join(dataDir, 'processed');

const { manifest, missing } = publishDatasets({ srcDir, destDir: staticDataDir });

if (manifest.datasets.length === 0) {
    console.error('[copy] No datasets published. Run the import scripts first.');
    process.exit(1);
}

const fileOf = new Map(DATASETS.map((d) => [d.id, d.file]));
recordImportRun(path.join(srcDir, '_metadata'), {
    sourceIds: [],
    inputFiles: manifest.datasets.map((d) => path.join(srcDir, fileOf.get(d.id)!)),
    stats: { created: manifest.datasets.length, updated: 0, skipped: missing.length, conflicts: 0 },
    datasets: manifest.datasets.map(({ id, version, contentHash }) => ({ id, version, contentHash })),
});

console.log(`[copy] Done - ${manifest.datasets.length}/${DATASETS.length} datasets in static/data/, manifest.json written.`);
