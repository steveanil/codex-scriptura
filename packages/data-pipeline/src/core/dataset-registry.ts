/**
 * Every logical dataset the pipeline publishes to static/data/ (issue #311).
 *
 * This list is the single owner of what ships: copy-to-static publishes
 * exactly these files, and the manifest it writes is how seed.ts learns the
 * translation catalog. Adding a translation means adding one entry here
 * plus its importer; nothing in the client needs to change.
 */

import type { TranslationMeta } from '@codex-scriptura/core';
import { translationDatasetId } from '@codex-scriptura/core';

export type DatasetDefinition = {
    /** Stable dataset identifier, e.g. "translation:kjv", "cross-references". */
    id: string;
    /** Processed JSON array under data/processed/. */
    file: string;
    /** Catalog metadata for translation datasets. */
    translation?: TranslationMeta;
};

const translation = (meta: TranslationMeta): DatasetDefinition => ({
    id: translationDatasetId(meta.id),
    file: `${meta.id.toLowerCase()}-verses.json`,
    translation: meta,
});

export const DATASETS: DatasetDefinition[] = [
    translation({
        id: 'KJV',
        name: 'King James Version',
        abbreviation: 'KJV',
        language: 'en',
        license: 'Public Domain',
        description: 'The Authorized King James Version (1769)',
        strongs: true,
        aligned: true,
    }),
    translation({
        id: 'OEB',
        name: 'Open English Bible',
        abbreviation: 'OEB',
        language: 'en',
        license: 'Public Domain (CC0)',
        description: 'Open English Bible - a free, open-license modern English translation (in progress: full NT, partial OT)',
        coverage: 'NT + partial OT',
    }),
    translation({
        id: 'WEB',
        name: 'World English Bible',
        abbreviation: 'WEB',
        language: 'en',
        license: 'Public Domain',
        description: 'World English Bible - a modern public domain translation',
        // Verse-level Strong's derived from OSHB morphhb + the Byzantine
        // Majority Text (issue #134) - no word alignment, so not `aligned`.
        strongs: true,
    }),
    translation({
        id: 'BSB',
        name: 'Berean Standard Bible',
        abbreviation: 'BSB',
        language: 'en',
        license: 'Public Domain',
        description: 'Berean Standard Bible - a modern, readable translation released into the public domain in 2023',
        strongs: true,
        aligned: true,
    }),
    translation({
        id: 'ASV',
        name: 'American Standard Version',
        abbreviation: 'ASV',
        language: 'en',
        license: 'Public Domain',
        description: 'American Standard Version (1901) - the classic formal-equivalence revision of the KJV',
        strongs: true,
        aligned: true,
    }),
    translation({
        id: 'YLT',
        name: "Young's Literal Translation",
        abbreviation: 'YLT',
        language: 'en',
        license: 'Public Domain',
        description: "Young's Literal Translation (1898) - a hyper-literal study translation",
    }),
    translation({
        id: 'DBY',
        name: 'Darby Translation',
        abbreviation: 'DBY',
        language: 'en',
        license: 'Public Domain',
        description: "Darby Translation (1890) - John Nelson Darby's formal translation",
        strongs: true,
        aligned: true,
    }),
    { id: 'persons', file: 'persons.json' },
    { id: 'places', file: 'places.json' },
    { id: 'events', file: 'events.json' },
    { id: 'dictionary', file: 'dictionary.json' },
    { id: 'cross-references', file: 'cross-references.json' },
    { id: 'genealogy', file: 'genealogy.json' },
    { id: 'lexicon-hebrew', file: 'lexicon-hebrew.json' },
    { id: 'lexicon-greek', file: 'lexicon-greek.json' },
    { id: 'naves-topics', file: 'naves-topics.json' },
];
