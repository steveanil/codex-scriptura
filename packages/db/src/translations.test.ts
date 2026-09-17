import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from './database';
import { getInstalledTranslationIds, removeTranslationData } from './translations';

describe('translation library (issue #238)', () => {
    beforeAll(async () => {
        await db.verses.bulkPut([
            { id: 'ASV.Gen.1.1', translationId: 'ASV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'a' },
            { id: 'DBY.Gen.1.1', translationId: 'DBY', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'd' },
            { id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'k' },
            { id: 'WEB.Gen.1.1', translationId: 'WEB', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'w' },
        ]);
    });

    it('lists installed translation ids from the verses index', async () => {
        expect(await getInstalledTranslationIds()).toEqual(['ASV', 'DBY', 'KJV', 'WEB']);
    });

    it('removeTranslationData deletes verses and per-translation index caches only', async () => {
        await db.translations.bulkPut([
            { id: 'ZZZ', name: 'Test', abbreviation: 'ZZZ', language: 'en', license: 'PD', description: '', verseCount: 1 },
            { id: 'KJV', name: 'KJV', abbreviation: 'KJV', language: 'en', license: 'PD', description: '', verseCount: 4 },
        ]);
        await db.verses.put({ id: 'ZZZ.Gen.1.1', translationId: 'ZZZ', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'z' });
        await db.searchIndexes.bulkPut([
            { id: 'minisearch:ZZZ', translationId: 'ZZZ', serializedIndex: '{}', verseCount: 1, createdAt: 0 },
            { id: 'palette:ZZZ', translationId: 'ZZZ', serializedIndex: '{}', verseCount: 1, createdAt: 0 },
            { id: 'minisearch:KJV', translationId: 'KJV', serializedIndex: '{}', verseCount: 4, createdAt: 0 },
        ]);

        const kjvBefore = await db.verses.where('translationId').equals('KJV').count();
        await removeTranslationData('ZZZ');

        expect(await getInstalledTranslationIds()).toEqual(['ASV', 'DBY', 'KJV', 'WEB']);
        expect(await db.searchIndexes.where('translationId').equals('ZZZ').count()).toBe(0);
        // Other translations' verses and caches are untouched
        expect(await db.searchIndexes.get('minisearch:KJV')).toBeDefined();
        expect(await db.verses.where('translationId').equals('KJV').count()).toBe(kjvBefore);
        // The catalog record survives with verseCount zeroed (re-downloadable)
        expect((await db.translations.get('ZZZ'))?.verseCount).toBe(0);
    });
});
