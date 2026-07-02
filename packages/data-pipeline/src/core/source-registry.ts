/**
 * Source Registry — canonical catalog of all datasets integrated into
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
    },
    'openbible-xref': {
        id: 'openbible-xref',
        name: 'OpenBible Cross-References (TSK-derived)',
        license: 'CC-BY-4.0',
        redistributable: true,
        url: 'https://github.com/openbibleinfo/Bible-Cross-Reference-Data',
        domains: ['cross-references'],
        precedence: {
            'cross-references': 1,
        },
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
    },
    'kjv-text': {
        id: 'kjv-text',
        name: 'King James Version',
        license: 'public-domain',
        redistributable: true,
        url: 'https://github.com/gratis-bible/bible',
        domains: ['text'],
        precedence: { text: 1 },
    },
    'web-text': {
        id: 'web-text',
        name: 'World English Bible',
        license: 'public-domain',
        redistributable: true,
        url: 'https://ebible.org/web/',
        domains: ['text'],
        precedence: { text: 1 },
    },
    'oeb-text': {
        id: 'oeb-text',
        name: 'Open English Bible',
        license: 'CC-BY-4.0',
        redistributable: true,
        url: 'https://github.com/openenglishbible/Open-English-Bible',
        domains: ['text'],
        precedence: { text: 1 },
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
