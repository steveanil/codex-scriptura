import path from 'node:path';
import { runEnrichPlaces } from './importers/enrich-places.js';
import { dataDir } from './core/paths.js';

/**
 * Enrich processed Theographic places with OpenBible geocoding coordinates.
 *
 * Input:
 *   data/processed/places.json              - Theographic place records (run import:theographic first)
 *   data/texts/openbible/ancient.jsonl      - OpenBible Bible Geocoding Data (JSONL format)
 *
 * Output:
 *   data/processed/places.json              - Overwritten in-place with enriched records
 *   data/processed/_metadata/*.json         - Updated resolution map and conflict records
 *
 * The merge policy and matching strategy are documented in importers/enrich-places.ts.
 *
 * Run from the repo root:
 *   cd packages/data-pipeline && pnpm run enrich:places
 */

runEnrichPlaces({
    placesJson:     path.join(dataDir, 'processed', 'places.json'),
    openBibleJsonl: path.join(dataDir, 'texts', 'openbible', 'ancient.jsonl'),
    metadataDir:    path.join(dataDir, 'processed', '_metadata'),
});
