import path from 'node:path';
import { importGenealogy } from './importers/import-genealogy.js';
import { dataDir } from './core/paths.js';

/**
 * Build genealogy relationship edges → JSON for runtime seeding.
 *
 * Primary input:  data/theographic/People.csv (family columns, native Theographic IDs)
 * Supplement:     data/texts/bibledata/BibleData-PersonRelationship.csv
 *                 (ancestor-of / half-sibling edges, exact ID resolution only)
 * Output:         data/processed/genealogy.json
 *                 (copy to static/data/ before serving)
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && pnpm run import:genealogy
 */

importGenealogy({
    theographicPeopleCsv: path.join(dataDir, 'theographic', 'People.csv'),
    bibleDataRelationshipCsv: path.join(dataDir, 'texts', 'bibledata', 'BibleData-PersonRelationship.csv'),
    personsJson: path.join(dataDir, 'processed', 'persons.json'),
    outputDir: path.join(dataDir, 'processed'),
});
