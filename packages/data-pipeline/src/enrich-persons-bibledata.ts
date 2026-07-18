import path from 'node:path';
import { runEnrichPersons } from './importers/enrich-persons.js';
import { dataDir } from './core/paths.js';

/**
 * Enrich processed Theographic persons with name meanings from BibleData PersonLabel.
 *
 * Input:
 *   data/processed/persons.json                              - Theographic person records
 *   data/texts/bibledata/BibleData-Person.csv                - BibleData person list (id → name)
 *   data/texts/bibledata/BibleData-PersonLabel.csv           - BibleData name labels (meaning, etymology)
 *   data/texts/bibledata/BibleData-PersonRelationship.csv    - BibleData genealogy edges (Stage 5)
 *   data/theographic/People.csv                              - Theographic family columns (Stage 5)
 *
 * Output:
 *   data/processed/persons.json                          - Overwritten in-place with enriched records
 *   data/processed/_metadata/resolution-map.json         - Updated with bibledata person ID mappings
 *   data/processed/_metadata/conflicts.json              - Updated with unresolvable ambiguities
 *
 * The five-stage resolution strategy is documented in importers/enrich-persons.ts.
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && pnpm run enrich:persons
 */

runEnrichPersons({
    personsJson:          path.join(dataDir, 'processed', 'persons.json'),
    personCsv:            path.join(dataDir, 'texts', 'bibledata', 'BibleData-Person.csv'),
    labelCsv:             path.join(dataDir, 'texts', 'bibledata', 'BibleData-PersonLabel.csv'),
    relationshipCsv:      path.join(dataDir, 'texts', 'bibledata', 'BibleData-PersonRelationship.csv'),
    theographicPeopleCsv: path.join(dataDir, 'theographic', 'People.csv'),
    metadataDir:          path.join(dataDir, 'processed', '_metadata'),
});
