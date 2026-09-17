import path from 'node:path';
import { dataDir, staticDataDir } from './core/paths.js';
import { DATASETS } from './core/dataset-registry.js';
import { publishDatasets, missingDatasets } from './core/dataset-manifest.js';
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

// Preflight before touching static/data/: every registered dataset must be
// present, or the deploy would go green with datasets silently missing.
const absent = missingDatasets(srcDir);
if (absent.length > 0) {
    console.error(
        `[copy] Refusing to publish: ${absent.length} of ${DATASETS.length} registered datasets have no processed file:\n` +
        absent.map((d) => `  ${d.id}  (${path.join(srcDir, d.file)})`).join('\n') +
        '\n  Run the import scripts first. Nothing was written or removed.'
    );
    process.exit(1);
}

const { manifest, missing } = publishDatasets({ srcDir, destDir: staticDataDir });

const fileOf = new Map(DATASETS.map((d) => [d.id, d.file]));
recordImportRun(path.join(srcDir, '_metadata'), {
    sourceIds: [],
    inputFiles: manifest.datasets.map((d) => path.join(srcDir, fileOf.get(d.id)!)),
    stats: { created: manifest.datasets.length, updated: 0, skipped: missing.length, conflicts: 0 },
    datasets: manifest.datasets.map(({ id, version, contentHash }) => ({ id, version, contentHash })),
});

console.log(`[copy] Done - ${manifest.datasets.length}/${DATASETS.length} datasets in static/data/, manifest.json written.`);
