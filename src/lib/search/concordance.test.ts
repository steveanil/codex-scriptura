import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { db } from '@codex-scriptura/db';
import { buildWordPattern, candidateStems } from './config';
import { searchWord, searchWordByLemma } from './concordance';
import { getOrBuildIndex } from './index-manager';

describe('searchWord apostrophes (issue #178)', () => {
    beforeAll(async () => {
        // The processed corpus stores possessives with U+2019, never U+0027
        await db.verses.bulkPut([
            { id: 'KJV.Ps.24.1', translationId: 'KJV', book: 'Ps', chapter: 24, verse: 1, osisId: 'Ps.24.1', text: 'The earth is the Lord’s, and the fulness thereof' },
        ]);
    });

    it('matches curly-apostrophe corpus text from a straight-apostrophe query', async () => {
        const results = await searchWord('KJV', "Lord's");
        expect(results.map((r) => r.verse.osisId)).toContain('Ps.24.1');
    });

    it('matches from curly and modifier-letter apostrophe queries too', async () => {
        expect((await searchWord('KJV', 'Lord’s')).map((r) => r.verse.osisId)).toContain('Ps.24.1');
        expect((await searchWord('KJV', 'Lordʼs')).map((r) => r.verse.osisId)).toContain('Ps.24.1');
    });

    it('keeps the apostrophe as a word boundary for bare-word queries', async () => {
        // "Lord" as a whole word still matches inside "Lord’s" - unchanged behavior
        expect((await searchWord('KJV', 'Lord')).map((r) => r.verse.osisId)).toContain('Ps.24.1');
    });
});

describe('buildWordPattern variants (issue #182)', () => {
    const matches = (query: string, text: string) => {
        const re = buildWordPattern(query, true)!;
        return (text.match(re) ?? []).map((m) => m.toLowerCase());
    };

    it('still covers the silent-e family the docstring promised', () => {
        expect(matches('love', 'love loved loves loving loveth lovest lover lovers lovely')).toEqual([
            'love', 'loved', 'loves', 'loving', 'loveth', 'lovest', 'lover', 'lovers',
        ]);
    });

    it('matches y -> i inflections from the base form', () => {
        expect(matches('glory', 'glory glories gloried glorieth glorious')).toEqual(['glory', 'glories', 'gloried', 'glorieth']);
        expect(matches('carry', 'carry carried carries carrieth carrying carriage')).toEqual(['carry', 'carried', 'carries', 'carrieth', 'carrying']);
    });

    it('matches the base form from a y -> i inflection', () => {
        expect(matches('glories', 'glory gloried')).toEqual(['glory', 'gloried']);
        expect(matches('carried', 'carry carries')).toEqual(['carry', 'carries']);
    });

    it('keeps vowel + y stems intact', () => {
        expect(matches('pray', 'pray prayed prayer prayers praying prey')).toEqual(['pray', 'prayed', 'prayer', 'prayers', 'praying']);
        expect(matches('day', 'day days daily')).toEqual(['day', 'days']);
    });

    it('matches roots that end in a doubled consonant', () => {
        expect(matches('bless', 'bless blessed blesses blessing blessings blesseth blest')).toEqual([
            'bless', 'blessed', 'blesses', 'blessing', 'blessings', 'blesseth',
        ]);
        expect(matches('blessed', 'bless blessing')).toEqual(['bless', 'blessing']);
        expect(matches('confess', 'confess confessed confesseth confession')).toEqual(['confess', 'confessed', 'confesseth']);
    });

    it('keeps a root double strict so the single-letter form does not leak in', () => {
        expect(matches('fill', 'fill filled filleth filth file')).toEqual(['fill', 'filled', 'filleth']);
        expect(matches('tell', 'tell telleth telling tel')).toEqual(['tell', 'telleth', 'telling']);
    });

    it('matches consonant doubling before a suffix, in both directions', () => {
        expect(matches('stop', 'stop stopped stopping stops')).toEqual(['stop', 'stopped', 'stopping', 'stops']);
        expect(matches('stopped', 'stop stops')).toEqual(['stop', 'stops']);
        expect(matches('sin', 'sin sinned sinneth sinner sinners sins since')).toEqual(['sin', 'sinned', 'sinneth', 'sinner', 'sinners', 'sins']);
    });

    it('matches ie -> y inflections', () => {
        expect(matches('lie', 'lie lied lies lieth lying')).toEqual(['lie', 'lied', 'lies', 'lieth', 'lying']);
        expect(matches('die', 'die died dieth dying diet dyed')).toEqual(['die', 'died', 'dieth', 'dying']);
    });

    it('always matches the query word itself', () => {
        for (const q of ['glory', 'bless', 'carry', 'Jesus', 'Moses', 'all', 'goes', 'was', 'his', 'us']) {
            const re = buildWordPattern(q, true)!;
            expect(q, `pattern ${re.source} misses its own query`).toMatch(re);
        }
    });

    it('leaves exact mode untouched', () => {
        expect(buildWordPattern('glory', false)!.source).toBe('\\bglory\\b');
    });
});

describe('Word Study on the stems field (issue #166)', () => {
    const verse = (osisId: string, text: string, extra: object = {}) => {
        const [book, chapter, v] = osisId.split('.');
        return { id: `DBY.${osisId}`, translationId: 'DBY', book, chapter: +chapter, verse: +v, osisId, text, ...extra };
    };

    beforeAll(async () => {
        await db.verses.bulkPut([
            verse('Gen.24.67', 'and he loved her', { lemmas: 'H157', align: '[[7,12,"H157"]]' }),
            verse('Ps.11.7', 'the LORD loveth righteousness, and shall judge'),
            verse('1Tim.3.3', 'not a lover of money; they that are lovers of God'),
            verse('John.3.16', 'For God so loved the world', { lemmas: 'G25', align: '[[11,16,"G25"]]' }),
            verse('John.6.37', 'him that cometh unto me I shall in no wise cast out'),
            verse('Gen.1.31', 'every thing that he had made; and he was not mad, nor drank wine to win'),
        ]);
    });

    const osis = async (word: string, variants = false, testament: 'all' | 'OT' | 'NT' = 'all') =>
        (await searchWord('DBY', word, variants, testament)).map((r) => r.verse.osisId).sort();

    it('finds the whole inflection family, including the -er forms the stemmer leaves alone', async () => {
        expect(await osis('love', true)).toEqual(['1Tim.3.3', 'Gen.24.67', 'John.3.16', 'Ps.11.7']);
        expect(await osis('loved', true)).toEqual(await osis('love', true));
        expect(await osis('loved')).toEqual(['Gen.24.67', 'John.3.16']);
        const tim = (await searchWord('DBY', 'love', true)).find((r) => r.verse.osisId === '1Tim.3.3')!;
        expect(tim.matches).toEqual([{ surface: 'lover', count: 1 }, { surface: 'lovers', count: 1 }]);
    });

    it('is exhaustive for stop words, which Full Text drops', async () => {
        expect(await osis('unto')).toEqual(['John.6.37']);
        expect(await osis('shall')).toEqual(['John.6.37', 'Ps.11.7']);
        expect(await osis('cometh unto me')).toEqual(['John.6.37']);
    });

    it('leaves the verdict to the regex: a shared stem is not a match', async () => {
        // "made" and "mad" share the stem "mad"; only the exact word counts
        expect((await searchWord('DBY', 'mad'))[0].matches).toEqual([{ surface: 'mad', count: 1 }]);
        expect((await searchWord('DBY', 'made'))[0].matches).toEqual([{ surface: 'made', count: 1 }]);
        expect(candidateStems('made', false)).toEqual([['mad']]);
    });

    it('applies the testament filter to the candidates', async () => {
        expect(await osis('love', true, 'NT')).toEqual(['1Tim.3.3', 'John.3.16']);
        const ot = await searchWordByLemma('DBY', 'loved', false, 'OT');
        expect(ot.groups.map((g) => g.strongsId)).toEqual(['H157']);
        expect(ot.totalVerses).toBe(1);
    });

    it('reads only the candidate verses, never the translation', async () => {
        await getOrBuildIndex('DBY');
        const where = vi.spyOn(db.verses, 'where');
        const bulkGet = vi.spyOn(db.verses, 'bulkGet');
        await searchWord('DBY', 'unto');
        await searchWordByLemma('DBY', 'loved');
        expect(where).not.toHaveBeenCalled();
        // Candidates share a stem with the query ("loveth" rides along for "loved"); the regex then rejects it
        expect(bulkGet.mock.calls.map(([ids]) => ids)).toEqual([['DBY.John.6.37'], ['DBY.Gen.24.67', 'DBY.John.3.16', 'DBY.Ps.11.7']]);
        where.mockRestore();
        bulkGet.mockRestore();
    });
});
