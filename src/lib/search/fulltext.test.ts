import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@codex-scriptura/db';
import type { VerseRecord } from '@codex-scriptura/core';
import { getOrBuildIndex, type SearchIndex } from './index-manager';
import { searchFullText } from './fulltext';

const verse = (osisId: string, text: string, translationId = 'KJV'): VerseRecord => {
    const [book, chapter, v] = osisId.split('.');
    return { id: `${translationId}.${osisId}`, translationId, book, chapter: +chapter, verse: +v, osisId, text } as VerseRecord;
};

let kjv: SearchIndex;
let web: SearchIndex;

beforeAll(async () => {
    await db.verses.clear();
    await db.verses.bulkPut([
        verse('Gen.1.1', 'In the beginning God created the heaven and the earth.'),
        verse('John.1.1', 'In the beginning was the Word, and the Word was with God.'),
        // Every word of the phrase, more often, but never the phrase itself
        verse('Prov.8.22', 'The beginning, his way, in beginning of works, beginning in old'),
        verse('Matt.5.5', 'Blessed are the meek: for they shall inherit the earth.'),
        verse('John.1.1', 'In the beginning was the Word.', 'WEB'),
    ]);
    kjv = await getOrBuildIndex('KJV');
    web = await getOrBuildIndex('WEB');
});

describe('searchFullText (issue #164)', () => {
    it('returns whole verse records though the index stores ids only', async () => {
        const hits = await searchFullText([kjv], 'meek');
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ id: 'KJV.Matt.5.5', book: 'Matt', chapter: 5, verse: 5, text: expect.stringContaining('meek') });
        expect(hits[0].score).toBeGreaterThan(0);
    });

    it('ranks verses holding the exact phrase above ones that only share its words', async () => {
        const hits = await searchFullText([kjv], 'in the beginning');
        const ids = hits.map((h) => h.id);
        expect(ids.indexOf('KJV.Prov.8.22')).toBeGreaterThan(ids.indexOf('KJV.Gen.1.1'));
        expect(ids.indexOf('KJV.Prov.8.22')).toBeGreaterThan(ids.indexOf('KJV.John.1.1'));
    });

    it('merges translations and honours the limit', async () => {
        const hits = await searchFullText([kjv, web], 'beginning');
        expect(new Set(hits.map((h) => h.translationId))).toEqual(new Set(['KJV', 'WEB']));
        expect(await searchFullText([kjv, web], 'beginning', { limit: 2 })).toHaveLength(2);
    });

    it('filters by testament before the limit is applied', async () => {
        const hits = await searchFullText([kjv], 'beginning', { testament: 'NT', limit: 1 });
        expect(hits.map((h) => h.id)).toEqual(['KJV.John.1.1']);
    });

    it('drops stop words and returns nothing for an empty query', async () => {
        expect(await searchFullText([kjv], 'the')).toEqual([]);
        expect(await searchFullText([kjv], '   ')).toEqual([]);
    });

    it('never answers from the stems field (issue #166)', async () => {
        await db.verses.put(verse('Ps.8.1', 'that his glories be carried', 'DBY'));
        const dby = await getOrBuildIndex('DBY');
        // `stems` holds "glory" and "carry" for this verse; the raw field does not, and neither is a prefix of its surface
        expect(await searchFullText([dby], 'glory')).toEqual([]);
        expect(await searchFullText([dby], 'carry')).toEqual([]);
        expect((await searchFullText([dby], 'glories')).map((h) => h.id)).toEqual(['DBY.Ps.8.1']);
        // Stop words are kept for Word Study but stay dropped here
        expect(await searchFullText([dby], 'that')).toEqual([]);
    });
});
