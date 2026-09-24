/**
 * Every logical dataset the pipeline publishes to static/data/ (issue #311).
 *
 * This list is the single owner of what ships: copy-to-static publishes
 * exactly these files, and the manifest it writes is how seed.ts learns the
 * translation catalog. Adding a translation means adding its resource in
 * resource-registry.ts, one entry here plus its importer; nothing in the
 * client needs to change.
 *
 * Every dataset belongs to a resource (issue #51): a translation and its
 * Strong's postings are one resource, and so are cross-references with
 * the aggregates derived from them.
 */

import type { TranslationMeta } from '@codex-scriptura/core';
import { strongsIndexDatasetId, translationDatasetId } from '@codex-scriptura/core';
import { getResourceDefinition, licenseInfo, resourceLicense } from './resource-registry.js';

export type DatasetDefinition = {
    /** Stable dataset identifier, e.g. "translation:kjv", "cross-references". */
    id: string;
    /** Processed JSON array under data/processed/. */
    file: string;
    /** The resource this dataset is part of (resource-registry.ts). */
    resource: string;
    /** Catalog metadata for translation datasets. */
    translation?: TranslationMeta;
    /**
     * The registry id this dataset is computed from (issue #38). Its
     * manifest entry records the source's content hash and folds it into
     * its own version, so a source refresh invalidates the aggregate even
     * when the aggregate's bytes happen not to change.
     */
    derivedFrom?: string;
};

type TranslationFlags = Pick<TranslationMeta, 'coverage' | 'strongs' | 'aligned'>;

/**
 * A translation's catalog record is the reader-facing copy of its resource
 * descriptor: name, description and license come from there, so the
 * picker and the credits screen can never disagree.
 */
const translation = (id: string, flags: TranslationFlags = {}): DatasetDefinition => {
    const resource = getResourceDefinition(id.toLowerCase());
    return {
        id: translationDatasetId(id),
        file: `${id.toLowerCase()}-verses.json`,
        resource: resource.id,
        translation: {
            id,
            name: resource.title,
            abbreviation: id,
            language: resource.language ?? 'en',
            license: licenseInfo(resourceLicense(resource)).name,
            description: resource.description ?? resource.title,
            ...flags,
        },
    };
};

/**
 * A tagged translation's Strong's postings (issue #166), derived from its
 * verses file. One per translation rather than one global dataset: it
 * installs, refreshes and leaves with exactly one parent.
 */
const strongsIndex = (parent: DatasetDefinition): DatasetDefinition => ({
    id: strongsIndexDatasetId(parent.translation!.id),
    file: `strongs-index-${parent.translation!.id.toLowerCase()}.json`,
    resource: parent.resource,
    derivedFrom: parent.id,
});

const TRANSLATIONS: DatasetDefinition[] = [
    translation('KJV', { strongs: true, aligned: true }),
    translation('OEB', { coverage: 'NT + partial OT' }),
    // Verse-level Strong's derived from OSHB morphhb + the Byzantine
    // Majority Text (issue #134) - no word alignment, so not `aligned`.
    translation('WEB', { strongs: true }),
    translation('BSB', { strongs: true, aligned: true }),
    translation('ASV', { strongs: true, aligned: true }),
    translation('YLT'),
    translation('DBY', { strongs: true, aligned: true }),
];

export const DATASETS: DatasetDefinition[] = [
    ...TRANSLATIONS,
    ...TRANSLATIONS.filter((t) => t.translation?.strongs).map(strongsIndex),
    { id: 'persons', file: 'persons.json', resource: 'theographic' },
    { id: 'places', file: 'places.json', resource: 'theographic' },
    { id: 'events', file: 'events.json', resource: 'theographic' },
    { id: 'dictionary', file: 'dictionary.json', resource: 'eastons' },
    { id: 'cross-references', file: 'cross-references.json', resource: 'cross-references' },
    // Precomputed from cross-references (issue #38): the 66x66 book matrix
    // the graph draws, and per-verse pair counts for #167's weighting
    { id: 'book-matrix', file: 'book-matrix.json', resource: 'cross-references', derivedFrom: 'cross-references' },
    { id: 'verse-degrees', file: 'verse-degrees.json', resource: 'cross-references', derivedFrom: 'cross-references' },
    { id: 'genealogy', file: 'genealogy.json', resource: 'genealogy' },
    { id: 'lexicon-hebrew', file: 'lexicon-hebrew.json', resource: 'strongs-hebrew' },
    { id: 'lexicon-greek', file: 'lexicon-greek.json', resource: 'strongs-greek' },
    { id: 'naves-topics', file: 'naves-topics.json', resource: 'naves' },
];
