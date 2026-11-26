import { describe, expect, it } from 'vitest';
import type { ResourceDescriptor } from '@codex-scriptura/core';
import { appearanceSummary, dictionaryTitle, groupRefsByBook, sourceCredits } from './entityFacts';

describe('groupRefsByBook (issue #455)', () => {
    it('groups by book in canonical order with the earliest reference of each book', () => {
        const groups = groupRefsByBook(['John.19.1', 'Matt.27.13', 'Matt.27.2', 'Acts.3.13', 'John.18.29', '1Tim.6.13']);
        expect(groups.map((g) => [g.name, g.count, `${g.first.chapter}:${g.first.verse}`])).toEqual([
            ['Matthew', 2, '27:2'],
            ['John', 2, '18:29'],
            ['Acts', 1, '3:13'],
            ['1 Timothy', 1, '6:13'],
        ]);
    });

    it('counts a repeated reference once and skips malformed ids', () => {
        const groups = groupRefsByBook(['Gen.1.1', 'Gen.1.1', 'Gen.1', 'nonsense']);
        expect(groups).toEqual([{ book: 'Gen', name: 'Genesis', count: 1, first: { chapter: 1, verse: 1 } }]);
    });

    it('summarises verses and books with plurals', () => {
        expect(appearanceSummary(groupRefsByBook(['Gen.1.1']))).toBe('1 verse in 1 book');
        expect(appearanceSummary(groupRefsByBook(['Gen.1.1', 'Exod.1.1', 'Exod.1.2']))).toBe('3 verses in 2 books');
    });
});

function resource(id: string, type: ResourceDescriptor['type'], title: string, provenance: Array<[string, string]>): ResourceDescriptor {
    return {
        id,
        type,
        title,
        language: 'en',
        license: { spdx: 'CC0-1.0', name: 'CC0' },
        provenance: provenance.map(([sourceId, name]) => ({ sourceId, name, url: '', license: 'CC0-1.0' })),
    } as unknown as ResourceDescriptor;
}

const registry = new Map([
    ['theographic', resource('theographic', 'entities', 'Theographic Bible Metadata', [['theographic', 'Theographic Bible Metadata'], ['bibledata', 'BibleData (Kaggle)'], ['openbible-geo', 'OpenBible Geocoding']])],
    ['eastons', resource('eastons', 'dictionary', "Easton's Bible Dictionary", [['theographic', 'Theographic Bible Metadata']])],
]);

describe('sourceCredits (issue #455)', () => {
    const pilate = [
        { sourceId: 'theographic', fields: ['id', 'name', 'verseRefs', 'gender', 'description'] },
        { sourceId: 'bibledata', fields: ['nameMeaning', 'nameMeaningSource'] },
    ];

    it('names each shown field by the registry and credits dictionary text to the dictionary', () => {
        expect(sourceCredits(pilate, registry, true)).toEqual([
            { fields: ['name meaning'], name: 'BibleData (Kaggle)', via: undefined },
            { fields: ['verses'], name: 'Theographic Bible Metadata', via: undefined },
            { fields: ['description'], name: "Easton's Bible Dictionary", via: 'Theographic Bible Metadata' },
        ]);
    });

    it('credits a description to its carrier when it is not dictionary text (events)', () => {
        const credits = sourceCredits([{ sourceId: 'theographic', fields: ['verseRefs', 'date', 'description'] }], registry, false);
        expect(credits).toEqual([{ fields: ['date', 'verses', 'description'], name: 'Theographic Bible Metadata', via: undefined }]);
    });

    it('leaves out sources the registry does not know, and everything when the registry is empty', () => {
        expect(sourceCredits([{ sourceId: 'mystery', fields: ['verseRefs'] }], registry, true)).toEqual([]);
        expect(sourceCredits(pilate, new Map(), true)).toEqual([]);
        expect(dictionaryTitle(new Map())).toBeNull();
        expect(dictionaryTitle(registry)).toBe("Easton's Bible Dictionary");
    });
});
