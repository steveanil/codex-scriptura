import path from 'node:path';
import { aggregateCrossReferences } from './importers/aggregate-cross-references.js';
import { dataDir } from './core/paths.js';

/**
 * Precompute the book matrix and per-verse degrees from the imported
 * cross-references (issue #38).
 *
 * Input:  data/processed/cross-references.json
 * Output: data/processed/book-matrix.json, data/processed/verse-degrees.json
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && npx tsx src/aggregate-cross-references.ts
 */

const processed = path.join(dataDir, 'processed');
aggregateCrossReferences(path.join(processed, 'cross-references.json'), processed);
