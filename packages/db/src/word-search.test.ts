import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from './database';
import { wordSearch } from './word-search';

describe('wordSearch', () => {
    beforeAll(async () => {
        await db.verses.bulkPut([
            { id: 'KJV.John.11.35', translationId: 'KJV', book: 'John', chapter: 11, verse: 35, osisId: 'John.11.35', text: 'Jesus wept.' },
            { id: 'KJV.Ps.136.1', translationId: 'KJV', book: 'Ps', chapter: 136, verse: 1, osisId: 'Ps.136.1', text: 'Mercy, mercy endureth; his Mercies' },
            { id: 'WEB.Ps.136.1', translationId: 'WEB', book: 'Ps', chapter: 136, verse: 1, osisId: 'Ps.136.1', text: 'mercy' },
        ]);
    });

    it('returns every candidate the pattern matches, with surfaces and counts', async () => {
        const results = await wordSearch(['KJV.John.11.35', 'KJV.Ps.136.1', 'KJV.Gone.1.1'], /\bmerc(?:y|ies)\b/gi);
        expect(results).toHaveLength(1);
        expect(results[0].verse.id).toBe('KJV.Ps.136.1');
        expect(results[0].hitCount).toBe(3);
        expect(results[0].matches).toEqual([{ surface: 'mercy', count: 2 }, { surface: 'mercies', count: 1 }]);
    });

    it('reads nothing but the candidates', async () => {
        expect(await wordSearch(['KJV.John.11.35'], /\bmercy\b/gi)).toEqual([]);
        expect(await wordSearch([], /\bmercy\b/gi)).toEqual([]);
    });
});
