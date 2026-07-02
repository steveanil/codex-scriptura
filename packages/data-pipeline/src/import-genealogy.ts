import path from 'node:path';
import { importGenealogy } from './importers/import-genealogy.js';

/**
 * Convert Genealogy CSV → JSON for runtime seeding.
 *
 * Input:  data/texts/bibledata/BibleData-PersonRelationship.csv
 * Output: data/processed/genealogy.json
 *         (copy to static/data/ before serving)
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && npx tsx src/import-genealogy.ts
 */

const dataDir = path.resolve(process.cwd(), '../../data');

importGenealogy(
    path.join(dataDir, 'texts', 'bibledata', 'BibleData-PersonRelationship.csv'),
    path.join(dataDir, 'processed')
);
