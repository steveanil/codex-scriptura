import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@codex-scriptura/db';
import { buildWordPattern } from './config';
import { searchWord } from './concordance';

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
