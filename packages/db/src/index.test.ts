import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db, getBookList, getChapterList, getVerse, getKv, setKv, deleteKv, parseStrongsQuery, strongsSearch, getStrongsForVerse, themeSlug, getThemes, getThemeAnnotations } from './index';
import type { Annotation } from '@codex-scriptura/core';

beforeAll(async () => {
    await db.verses.bulkPut([
        { id: 'KJV.Gen.1.1', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'a' },
        { id: 'KJV.Gen.1.2', translationId: 'KJV', book: 'Gen', chapter: 1, verse: 2, osisId: 'Gen.1.2', text: 'b' },
        { id: 'KJV.Gen.2.1', translationId: 'KJV', book: 'Gen', chapter: 2, verse: 1, osisId: 'Gen.2.1', text: 'c' },
        { id: 'KJV.Matt.1.1', translationId: 'KJV', book: 'Matt', chapter: 1, verse: 1, osisId: 'Matt.1.1', text: 'd' },
        // Different translation - must never bleed into KJV results
        { id: 'WEB.Exod.1.1', translationId: 'WEB', book: 'Exod', chapter: 1, verse: 1, osisId: 'Exod.1.1', text: 'e' },
        // Bridged record: verses 15–16 stored once under verse 15
        { id: 'WEB.Neh.7.15', translationId: 'WEB', book: 'Neh', chapter: 7, verse: 15, verseEnd: 16, osisId: 'Neh.7.15', text: 'bridged' },
    ]);
});

describe('getVerse (bridge-aware)', () => {
    it('returns a direct match', async () => {
        expect((await getVerse('KJV', 'Gen.1.2'))?.text).toBe('b');
    });

    it('resolves the second verse of a bridge to the bridge record', async () => {
        const v = await getVerse('WEB', 'Neh.7.16');
        expect(v?.osisId).toBe('Neh.7.15');
        expect(v?.verseEnd).toBe(16);
    });

    it('does not resolve verses outside the bridge range', async () => {
        expect(await getVerse('WEB', 'Neh.7.17')).toBeUndefined();
        expect(await getVerse('KJV', 'Neh.7.16')).toBeUndefined();
    });
});

describe('getBookList (index-only scan)', () => {
    it('returns canonical-ordered books for the given translation only', async () => {
        expect(await getBookList('KJV')).toEqual(['Gen', 'Matt']);
        expect(await getBookList('WEB')).toEqual(['Exod', 'Neh']);
    });

    it('returns empty for an unseeded translation', async () => {
        expect(await getBookList('OEB')).toEqual([]);
    });
});

describe('getChapterList (index-only scan)', () => {
    it('returns sorted chapters for a book, scoped to the translation', async () => {
        expect(await getChapterList('KJV', 'Gen')).toEqual([1, 2]);
        expect(await getChapterList('KJV', 'Matt')).toEqual([1]);
        expect(await getChapterList('WEB', 'Gen')).toEqual([]);
    });
});

describe('parseStrongsQuery', () => {
    it('normalizes case and strips leading zeros', () => {
        expect(parseStrongsQuery('h7225')).toBe('H7225');
        expect(parseStrongsQuery('G0026')).toBe('G26');
        expect(parseStrongsQuery(' H430 ')).toBe('H430');
    });

    it('rejects non-Strong\'s queries', () => {
        expect(parseStrongsQuery('love')).toBeNull();
        expect(parseStrongsQuery('H')).toBeNull();
        expect(parseStrongsQuery('H72a5')).toBeNull();
        expect(parseStrongsQuery('X430')).toBeNull();
        expect(parseStrongsQuery('H430 G26')).toBeNull();
        expect(parseStrongsQuery('H123456')).toBeNull();
    });
});

describe('strongsSearch', () => {
    beforeAll(async () => {
        await db.verses.bulkPut([
            { id: 'ASV.Gen.1.1', translationId: 'ASV', book: 'Gen', chapter: 1, verse: 1, osisId: 'Gen.1.1', text: 'In the beginning God created', lemmas: 'H8064 H1254 H7225' },
            { id: 'ASV.Gen.1.2', translationId: 'ASV', book: 'Gen', chapter: 1, verse: 2, osisId: 'Gen.1.2', text: 'And the earth was waste', lemmas: 'H776 H1961' },
            // H1254 appears twice in one verse - hitCount must reflect it
            { id: 'ASV.Gen.2.4', translationId: 'ASV', book: 'Gen', chapter: 2, verse: 4, osisId: 'Gen.2.4', text: 'These are the generations', lemmas: 'H1254 H8064 H1254' },
        ]);
        await db.lexicon.bulkPut([
            { id: 'H7225', strongsNumber: 'H7225', language: 'hebrew', lemma: 'רֵאשִׁית', transliteration: "re'shith", gloss: 'beginning' },
            { id: 'H1254', strongsNumber: 'H1254', language: 'hebrew', lemma: 'בָּרָא', transliteration: 'bara', gloss: 'to create' },
        ]);
    });

    it('finds every verse whose lemma tokens include the ID, with per-verse counts', async () => {
        const results = await strongsSearch('ASV', 'H1254');
        expect(results.map(r => r.verse.osisId)).toEqual(['Gen.1.1', 'Gen.2.4']);
        expect(results.map(r => r.hitCount)).toEqual([1, 2]);
    });

    it('matches whole tokens only (H725/H7225 must not cross-match) and normalizes the query', async () => {
        expect(await strongsSearch('ASV', 'H725')).toEqual([]);
        expect((await strongsSearch('ASV', 'h7225')).map(r => r.verse.osisId)).toEqual(['Gen.1.1']);
    });

    it('returns nothing for untagged translations and non-Strong\'s queries', async () => {
        expect(await strongsSearch('KJV', 'H1254')).toEqual([]);
        expect(await strongsSearch('ASV', 'beginning')).toEqual([]);
    });
});

describe('getStrongsForVerse', () => {
    it('returns the lexicon entries for a tagged verse, deduplicated', async () => {
        const entries = await getStrongsForVerse('ASV', 'Gen.2.4');
        expect(entries.map(e => e.id)).toEqual(['H1254']);
    });

    it('returns empty for untagged verses and unknown references', async () => {
        expect(await getStrongsForVerse('KJV', 'Gen.1.1')).toEqual([]);
        expect(await getStrongsForVerse('ASV', 'Gen.99.1')).toEqual([]);
    });
});

describe('kv store', () => {
    it('round-trips structured values', async () => {
        await setKv('t', { count: 2, locations: [{ book: 'Gen', chapter: 1 }] });
        expect(await getKv<{ count: number }>('t')).toEqual({
            count: 2,
            locations: [{ book: 'Gen', chapter: 1 }],
        });
    });

    it('overwrites on repeat set and returns undefined after delete / for missing keys', async () => {
        await setKv('t2', 1);
        await setKv('t2', 2);
        expect(await getKv<number>('t2')).toBe(2);
        await deleteKv('t2');
        expect(await getKv('t2')).toBeUndefined();
        expect(await getKv('never-set')).toBeUndefined();
    });
});

describe('theme threading', () => {
    function theme(over: Partial<Annotation>): Annotation {
        return {
            id: crypto.randomUUID(),
            type: 'theme',
            book: 'Gen',
            verseStart: 'Gen.1.1',
            verseEnd: 'Gen.1.1',
            data: 'Covenant',
            tags: ['covenant'],
            created: 1,
            modified: 1,
            synced: false,
            ...over,
        };
    }

    it('themeSlug normalizes labels to a shared thread identity', () => {
        expect(themeSlug('Covenant')).toBe('covenant');
        expect(themeSlug("God's Covenant")).toBe('gods-covenant');
        expect(themeSlug('  Kingdom of God! ')).toBe('kingdom-of-god');
        expect(themeSlug('!!!')).toBe('');
    });

    it('getThemes groups by slug, counts ranges, and prefers the latest label', async () => {
        await db.annotations.bulkPut([
            theme({ modified: 1 }),
            theme({ verseStart: 'Exod.19.5', verseEnd: 'Exod.19.6', book: 'Exod', data: 'covenant', modified: 5 }),
            theme({ data: 'Faith', tags: ['faith'] }),
            // Non-theme annotations with matching tags must not leak in
            { id: 'n1', type: 'note', book: 'Gen', verseStart: 'Gen.2.1', verseEnd: 'Gen.2.1', data: 'note', tags: ['covenant'], created: 1, modified: 1, synced: false },
        ]);
        const themes = await getThemes();
        const covenant = themes.find(t => t.slug === 'covenant');
        expect(covenant).toEqual({ slug: 'covenant', label: 'covenant', count: 2 });
        expect(themes.find(t => t.slug === 'faith')?.count).toBe(1);
    });

    it('getThemeAnnotations resolves via the tags index and excludes other types', async () => {
        const anns = await getThemeAnnotations('covenant');
        expect(anns).toHaveLength(2);
        expect(anns.every(a => a.type === 'theme')).toBe(true);
    });
});
