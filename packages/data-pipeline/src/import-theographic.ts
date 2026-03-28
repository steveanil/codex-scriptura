import path from 'node:path';
import { importTheographic } from './importers/import-theographic.js';

/**
 * Convert Theographic CSV source files → JSON for runtime seeding.
 *
 * Input:  data/theographic/{People,Places,Events,Easton}.csv
 * Output: data/processed/{persons,places,events,dictionary}.json
 *         (copy these to static/data/ before serving)
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && npx tsx src/import-theographic.ts
 */

const dataDir = path.resolve(process.cwd(), '../../data');

importTheographic(
    path.join(dataDir, 'theographic'),
    path.join(dataDir, 'processed')
);
