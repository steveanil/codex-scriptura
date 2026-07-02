import path from 'node:path';
import { importCrossReferences } from './importers/import-cross-references.js';

/**
 * Convert OpenBible cross-references TXT → JSON for runtime seeding.
 *
 * Input:  data/texts/openbible/cross_references.txt
 * Output: data/processed/cross-references.json
 *         (copy to static/data/ before serving)
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && npx tsx src/import-cross-references.ts
 */

const dataDir = path.resolve(process.cwd(), '../../data');

importCrossReferences(
    path.join(dataDir, 'texts', 'openbible', 'cross_references.txt'),
    path.join(dataDir, 'processed')
);
