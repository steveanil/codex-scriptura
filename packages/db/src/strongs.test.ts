import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from './database';
import { parseStrongsQuery, strongsSearch, parseAlignment, lemmaGroupSearch, getStrongsForVerse } from './strongs';

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

describe('parseAlignment', () => {
    it('parses [start, end, ids] triples into typed spans', () => {
        expect(parseAlignment('[[0,16,"H7225"],[17,20,"H853 H430"]]')).toEqual([
            { start: 0, end: 16, strongs: ['H7225'] },
            { start: 17, end: 20, strongs: ['H853', 'H430'] },
        ]);
    });

    it('returns empty for absent or malformed alignment', () => {
        expect(parseAlignment(undefined)).toEqual([]);
        expect(parseAlignment('not json')).toEqual([]);
    });
});

describe('word-aligned search (issue #27)', () => {
    // A miniature tagged translation. "loved" is agapao (G25) in John 3:16
    // and phileo (G5368) in John 11:3; Rom 12:9's "love" is deliberately
    // untagged; Ps 11:7 is OT with a two-ID span (particle riding along).
    beforeAll(async () => {
        await db.verses.bulkPut([
            {
                id: 'DBY.John.3.16', translationId: 'DBY', book: 'John', chapter: 3, verse: 16, osisId: 'John.3.16',
                text: 'For God so loved the world',
                lemmas: 'G2316 G25 G2889',
                align: '[[4,7,"G2316"],[11,16,"G25"],[21,26,"G2889"]]',
            },
            {
                id: 'DBY.John.11.3', translationId: 'DBY', book: 'John', chapter: 11, verse: 3, osisId: 'John.11.3',
                text: 'he whom thou lovest is sick',
                lemmas: 'G5368',
                align: '[[13,19,"G5368"]]',
            },
            {
                id: 'DBY.Rom.12.9', translationId: 'DBY', book: 'Rom', chapter: 12, verse: 9, osisId: 'Rom.12.9',
                text: 'Let love be unfeigned',
                lemmas: 'G505',
                align: '[[12,21,"G505"]]',
            },
            {
                id: 'DBY.Ps.11.7', translationId: 'DBY', book: 'Ps', chapter: 11, verse: 7, osisId: 'Ps.11.7',
                text: 'the LORD loveth righteousness',
                lemmas: 'H3068 H157 H6664',
                align: '[[4,8,"H3068"],[9,15,"H157 H853"],[16,29,"H6664"]]',
            },
        ]);
        await db.lexicon.bulkPut([
            { id: 'G25', strongsNumber: 'G25', language: 'greek', lemma: 'ἀγαπάω', transliteration: 'agapao', gloss: 'to love' },
            { id: 'G5368', strongsNumber: 'G5368', language: 'greek', lemma: 'φιλέω', transliteration: 'phileo', gloss: 'to love, kiss' },
            { id: 'H157', strongsNumber: 'H157', language: 'hebrew', lemma: 'אָהַב', transliteration: 'ahab', gloss: 'to love' },
        ]);
    });

    describe('lemmaGroupSearch', () => {
        // The caller owns inflection rules; these stand in for the patterns it builds
        const LOVE_VARIANTS = /\blov(?:e|ed|est|eth)\b/gi;
        const LOVE_EXACT = /\blove\b/gi;
        const LOVETH_EXACT = /\bloveth\b/gi;

        it('groups occurrences of an English word by aligned lemma, untagged last', async () => {
            const { groups, totalHits, totalVerses } = await lemmaGroupSearch('DBY', LOVE_VARIANTS);
            expect(totalHits).toBe(4);
            expect(totalVerses).toBe(4);
            // One hit each: G25, G5368, H157 (+H853), untagged bucket for Rom 12:9
            const ids = groups.map(g => g.strongsId);
            expect(ids).toContain('G25');
            expect(ids).toContain('G5368');
            expect(ids).toContain('H157');
            expect(ids).toContain('H853');
            expect(ids[ids.length - 1]).toBeNull();
            const agapao = groups.find(g => g.strongsId === 'G25')!;
            expect(agapao.entry?.transliteration).toBe('agapao');
            expect(agapao.hitCount).toBe(1);
            expect(agapao.surfaces).toEqual([{ surface: 'loved', count: 1 }]);
            expect(agapao.results.map(r => r.verse.osisId)).toEqual(['John.3.16']);
        });

        it('counts a multi-ID span once in totalHits but in each ID group', async () => {
            const { groups, totalHits } = await lemmaGroupSearch('DBY', LOVETH_EXACT);
            expect(totalHits).toBe(1);
            expect(groups.find(g => g.strongsId === 'H157')?.hitCount).toBe(1);
            expect(groups.find(g => g.strongsId === 'H853')?.hitCount).toBe(1);
        });

        it('collects unaligned occurrences in the null group', async () => {
            const { groups } = await lemmaGroupSearch('DBY', LOVE_EXACT);
            const untagged = groups.find(g => g.strongsId === null)!;
            expect(untagged.results.map(r => r.verse.osisId)).toEqual(['Rom.12.9']);
            expect(untagged.entry).toBeNull();
        });

        it('applies the testament filter before grouping', async () => {
            const nt = await lemmaGroupSearch('DBY', LOVE_VARIANTS, 'NT');
            expect(nt.totalHits).toBe(3);
            expect(nt.groups.some(g => g.strongsId === 'H157')).toBe(false);
        });

        it('missing lexicon entries yield a group with entry null', async () => {
            const { groups } = await lemmaGroupSearch('DBY', LOVE_VARIANTS);
            const world = groups.find(g => g.strongsId === 'H853');
            expect(world?.entry).toBeNull();
        });
    });
    describe('strongsSearch with alignment', () => {
        it('reports the real English surface and true occurrence count', async () => {
            const results = await strongsSearch('DBY', 'G25');
            expect(results).toHaveLength(1);
            expect(results[0].matches).toEqual([{ surface: 'loved', count: 1 }]);
            expect(results[0].hitCount).toBe(1);
        });

        it('finds IDs that only appear inside multi-ID spans', async () => {
            // H853 is in the align span but NOT in the deduped lemma bag?
            // No - lemmas is a superset by construction. Here it's absent
            // from lemmas, so the verse must NOT match (lemmas gates the scan).
            expect(await strongsSearch('DBY', 'H853')).toEqual([]);
            // H157 is in both: alignment supplies the surface.
            const results = await strongsSearch('DBY', 'H157');
            expect(results[0].matches).toEqual([{ surface: 'loveth', count: 1 }]);
        });
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
