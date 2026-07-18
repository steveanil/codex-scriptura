/**
 * Source Registry - canonical catalog of all datasets integrated into
 * Codex Scriptura.
 *
 * This is the single source of truth for dataset metadata: licenses,
 * URLs, domain coverage, and precedence tiers. Pipeline scripts
 * reference this registry rather than hardcoding source metadata.
 *
 * See docs/data-architecture.md §2 for the full specification.
 */

import type { SourceDataset } from './types.js';

// ─── Dataset Definitions ─────────────────────────────────

export const SOURCES: Record<string, SourceDataset> = {
    theographic: {
        id: 'theographic',
        name: 'Theographic Bible Metadata',
        license: 'CC-BY-SA-4.0',
        redistributable: true,
        url: 'https://github.com/robertrouse/theographic-bible-metadata',
        domains: ['persons', 'places', 'events', 'dictionary'],
        precedence: {
            persons: 1,
            places: 1,
            events: 1,
            dictionary: 1,
        },
        version: 'cfb1c485d4da6fb63a69cb3b7f5b0752792f46bc', // pinned in fetch-theographic.ts
    },
    'openbible-geo': {
        id: 'openbible-geo',
        name: 'OpenBible Geocoding',
        license: 'CC-BY-4.0',
        redistributable: true,
        url: 'https://github.com/openbibleinfo/Bible-Geocoding-Data',
        domains: ['places'],
        precedence: {
            places: 2, // GPS enrichment, secondary to Theographic backbone
        },
        version: '7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f', // pinned in fetch-openbible.ts
    },
    'openbible-xref': {
        id: 'openbible-xref',
        name: 'OpenBible Cross-References (TSK-derived)',
        license: 'CC-BY-4.0',
        redistributable: true,
        url: 'https://www.openbible.info/labs/cross-references/',
        domains: ['cross-references'],
        precedence: {
            'cross-references': 1,
        },
        // a.openbible.info serves only the latest build - no pin possible;
        // import-runs.json records when it was consumed.
    },
    'otnt-reference-map': {
        id: 'otnt-reference-map',
        name: 'OT-NT Reference Map (balinjdl)',
        license: 'BSD-2-Clause',
        redistributable: true,
        url: 'https://github.com/balinjdl/OT-NT-Reference-Map',
        domains: ['cross-references'],
        precedence: {
            'cross-references': 2, // type overlay on the TSK backbone
        },
        version: 'ece9fc5328023331339f6ac53b0f6804cbe980d6', // pinned in fetch-typed-crossrefs.ts
    },
    'ubs-parallel-passages': {
        id: 'ubs-parallel-passages',
        name: 'UBS Parallel Passages',
        license: 'CC-BY-SA-4.0',
        redistributable: true,
        url: 'https://github.com/ubsicap/ubs-open-license',
        domains: ['cross-references'],
        precedence: {
            'cross-references': 2, // type overlay on the TSK backbone
        },
        version: 'aa457644f376f7623f4e09549cf8f4ecabf04983', // pinned in fetch-typed-crossrefs.ts
    },
    'openscriptures-greek': {
        id: 'openscriptures-greek',
        name: "OpenScriptures Greek Strong's Dictionary",
        license: 'CC-BY-SA-3.0',
        redistributable: true,
        url: 'https://github.com/openscriptures/strongs',
        domains: ['lexicon'],
        precedence: {
            lexicon: 1, // primary for Greek Strong's (bibledata covers Hebrew)
        },
        version: '0acd2f251c2d35ff8db2dece4e0593979d3ac223', // pinned in fetch-openscriptures-greek.ts
    },
    bibledata: {
        id: 'bibledata',
        name: 'BibleData (Kaggle)',
        license: 'Open',
        redistributable: true,
        url: 'https://github.com/BradyStephenson/bible-data',
        domains: ['persons', 'relationships', 'lexicon'],
        precedence: {
            persons: 2,       // enrichment to Theographic backbone
            relationships: 1, // primary source for genealogy
            lexicon: 1,       // primary source for Strong's data
        },
        version: '2b81fe41dd62306724cc2bd207e6fc86edca0af0', // pinned in fetch-bibledata.ts
    },
    'kjv-text': {
        id: 'kjv-text',
        name: 'King James Version',
        license: 'public-domain',
        redistributable: true,
        url: 'https://github.com/seven1m/open-bibles', // actual fetch upstream (OSIS)
        domains: ['text'],
        precedence: { text: 1 },
        version: '8c31c380a9f7af19fbe04e8eaaa6fa74601083d7', // pinned in fetch-texts.ts
    },
    'web-text': {
        id: 'web-text',
        name: 'World English Bible',
        license: 'public-domain',
        redistributable: true,
        url: 'https://ebible.org/web/',
        domains: ['text'],
        precedence: { text: 1 },
        // ebible.org serves only the latest build - no pin possible;
        // import-runs.json records when it was consumed.
    },
    'oeb-text': {
        id: 'oeb-text',
        name: 'Open English Bible (US Edition)',
        license: 'CC-BY-4.0',
        redistributable: true,
        url: 'https://github.com/seven1m/open-bibles', // actual fetch upstream (OSIS)
        domains: ['text'],
        precedence: { text: 1 },
        version: '8c31c380a9f7af19fbe04e8eaaa6fa74601083d7', // pinned in fetch-texts.ts
    },
};

// ─── Lookup helpers ──────────────────────────────────────

/** Get a registered source by ID. Throws if not found. */
export function getSource(id: string): SourceDataset {
    const source = SOURCES[id];
    if (!source) {
        throw new Error(`[SourceRegistry] Unknown source dataset: "${id}". Register it in source-registry.ts.`);
    }
    return source;
}

/** Get all sources that cover a given domain, sorted by precedence (ascending = higher priority). */
export function getSourcesForDomain(domain: string): SourceDataset[] {
    return Object.values(SOURCES)
        .filter(s => s.precedence[domain as keyof typeof s.precedence] !== undefined)
        .sort((a, b) => {
            const pa = a.precedence[domain as keyof typeof a.precedence] ?? 999;
            const pb = b.precedence[domain as keyof typeof b.precedence] ?? 999;
            return pa - pb;
        });
}

/** Get all registered source IDs. */
export function getAllSourceIds(): string[] {
    return Object.keys(SOURCES);
}
