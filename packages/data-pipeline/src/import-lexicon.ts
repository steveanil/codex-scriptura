import path from 'node:path';
import { importHebrewStrongs } from './importers/import-hebrew-strongs.js';
import { importGreekStrongs } from './importers/import-greek-strongs.js';

/**
 * Convert Strong's source data → JSON for runtime seeding.
 *
 * Hebrew:
 *   Source: BibleData HebrewStrongs.csv (BradyStephenson/bible-data)
 *   Input:  data/texts/bibledata/HebrewStrongs.csv
 *   Output: data/processed/lexicon-hebrew.json
 *
 * Greek:
 *   Source: OpenScriptures strongs-greek-dictionary.js (openscriptures/strongs)
 *   Input:  data/texts/openscriptures/strongs-greek-dictionary.js
 *   Output: data/processed/lexicon-greek.json
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && pnpm run import:lexicon
 */

const dataDir = path.resolve(process.cwd(), '../../data');

importHebrewStrongs(
    path.join(dataDir, 'texts', 'bibledata', 'HebrewStrongs.csv'),
    path.join(dataDir, 'processed'),
);

importGreekStrongs(
    path.join(dataDir, 'texts', 'openscriptures', 'strongs-greek-dictionary.js'),
    path.join(dataDir, 'processed'),
);
