import { describe, it, expect } from 'vitest';
import { normalizeVerse, classifyEdge, parseCrossReferences, compareOsis, orientPair } from './import-cross-references.js';
import type { TypeOverlay, OverlayType } from './parse-typed-overlays.js';

function overlay(over: Partial<Pick<TypeOverlay, 'versePairs' | 'chapterPairs'>> = {}): TypeOverlay {
    return {
        versePairs: over.versePairs ?? new Map<string, OverlayType>(),
        chapterPairs: over.chapterPairs ?? new Map<string, OverlayType>(),
        stats: { otntEntries: 0, ubsGroups: 0, ubsVersePairs: 0 },
    };
}

describe('normalizeVerse', () => {
    it('passes through a single OSIS reference', () => {
        expect(normalizeVerse('Gen.1.1')).toBe('Gen.1.1');
        expect(normalizeVerse('  1Cor.13.4 ')).toBe('1Cor.13.4');
    });

    it('takes the start verse of a range', () => {
        expect(normalizeVerse('Col.1.16-Col.1.17')).toBe('Col.1.16');
    });

    it('rejects malformed references', () => {
        expect(normalizeVerse('')).toBeNull();
        expect(normalizeVerse('Gen.1')).toBeNull();
        expect(normalizeVerse('Genesis 1:1')).toBeNull();
    });
});

describe('compareOsis / orientPair (issue #183)', () => {
    it('orders by canon book, then chapter, then verse (numerically)', () => {
        expect(compareOsis('Gen.1.1', 'Exod.1.1')).toBeLessThan(0);
        expect(compareOsis('Mal.4.6', 'Matt.1.1')).toBeLessThan(0);
        expect(compareOsis('Ps.119.1', 'Ps.2.1')).toBeGreaterThan(0);
        expect(compareOsis('Ps.1.10', 'Ps.1.9')).toBeGreaterThan(0);
        expect(compareOsis('Gen.1.1', 'Gen.1.1')).toBe(0);
    });

    it('sorts books outside the canon list after it, alphabetically', () => {
        expect(compareOsis('Rev.22.21', 'Tob.1.1')).toBeLessThan(0);
        expect(compareOsis('Tob.1.1', 'Sir.1.1')).toBeGreaterThan(0);
    });

    it('puts the later verse as source and the earlier as target, whichever way it is given', () => {
        const expected = { sourceVerse: 'Jer.10.12', targetVerse: 'Gen.1.1' };
        expect(orientPair('Gen.1.1', 'Jer.10.12')).toEqual(expected);
        expect(orientPair('Jer.10.12', 'Gen.1.1')).toEqual(expected);
    });
});

describe('classifyEdge - structural heuristics (Tier 2)', () => {
    it('is symmetric in its endpoints, so one classification per pair is well defined', () => {
        // One-directional overlay keys on purpose: symmetry must not depend on the data
        const o = overlay({
            versePairs: new Map([['Gen.1.27→Matt.19.4', 'parallel']]),
            chapterPairs: new Map([['Acts.8→Isa.53', 'quotation']]),
        });
        const pairs: Array<[string, string, number]> = [
            ['Isa.7.14', 'Matt.1.23', 150],
            ['Matt.3.1', 'Mark.1.4', 1],
            ['2Sam.7.1', '1Chr.17.1', 2],
            ['Ps.22.1', 'Ps.24.7', 5],
            ['Gen.1.1', 'John.1.1', 30],
            ['Gen.12.1', 'Exod.3.1', 20],
            ['Gen.12.1', 'Exod.3.1', 1],
            ['Gen.1.27', 'Matt.19.4', 12],
            ['Isa.53.7', 'Acts.8.32', 4],
            ['Isa.53.7', 'Acts.8.32', 1],
        ];
        for (const [a, b, votes] of pairs) {
            expect(classifyEdge(a, b, votes, o)).toBe(classifyEdge(b, a, votes, o));
        }
    });

    it('votes alone never yield quotation: cross-testament ≥ 100 without overlay evidence is allusion (issue #282)', () => {
        expect(classifyEdge('Matt.1.23', 'Isa.7.14', 150, null)).toBe('allusion');
        expect(classifyEdge('Rom.8.28', 'Gen.50.20', 383, null)).toBe('allusion');
        expect(classifyEdge('John.3.16', 'Gen.22.12', 164, null)).toBe('allusion');
    });

    it('parallel: inter-book synoptic links regardless of votes', () => {
        expect(classifyEdge('Matt.3.1', 'Mark.1.4', 1, null)).toBe('parallel');
        expect(classifyEdge('Luke.9.10', 'Mark.6.30', 4, null)).toBe('parallel');
    });

    it('parallel: Samuel/Kings ↔ Chronicles inter-book links', () => {
        expect(classifyEdge('2Sam.7.1', '1Chr.17.1', 2, null)).toBe('parallel');
        expect(classifyEdge('2Kgs.18.1', '2Chr.29.1', 1, null)).toBe('parallel');
    });

    it('parallel: same-book links within 5 chapters at votes ≥ 5', () => {
        expect(classifyEdge('Ps.22.1', 'Ps.24.7', 5, null)).toBe('parallel');
    });

    it('same-book links more than 5 chapters apart fall through to keyword', () => {
        expect(classifyEdge('Ps.1.1', 'Ps.119.1', 5, null)).toBe('keyword');
    });

    it('allusion: cross-testament with votes 30–99', () => {
        expect(classifyEdge('Gen.1.1', 'John.1.1', 30, null)).toBe('allusion');
        expect(classifyEdge('Gen.1.1', 'John.1.1', 99, null)).toBe('allusion');
    });

    it('theme: cross-testament at votes ≥ 10, same-testament at votes ≥ 20', () => {
        expect(classifyEdge('Gen.1.1', 'John.1.1', 10, null)).toBe('theme');
        expect(classifyEdge('Gen.12.1', 'Exod.3.1', 20, null)).toBe('theme');
    });

    it('keyword: remaining links with votes ≥ 3', () => {
        expect(classifyEdge('Gen.12.1', 'Exod.3.1', 3, null)).toBe('keyword');
    });
});

describe('classifyEdge - relaxed fallback (Tier 3, votes 1–2)', () => {
    it('cross-testament → theme', () => {
        expect(classifyEdge('Gen.1.1', 'John.1.1', 1, null)).toBe('theme');
    });

    it('same-book → parallel', () => {
        // Note the vote inversion is intended: a 2-vote same-book link is
        // 'parallel' (Tier 3) while 3–4 votes classify as 'keyword' (Rule 5).
        expect(classifyEdge('Ps.22.1', 'Ps.24.7', 2, null)).toBe('parallel');
    });

    it('same-testament, different book → keyword', () => {
        expect(classifyEdge('Gen.12.1', 'Exod.3.1', 1, null)).toBe('keyword');
        expect(classifyEdge('Rom.5.1', 'Gal.3.1', 2, null)).toBe('keyword');
    });
});

describe('classifyEdge - typed overlay (Tier 1)', () => {
    it('a verse-pair overlay entry beats the heuristics', () => {
        const o = overlay({ versePairs: new Map([['Gen.1.27→Matt.19.4', 'parallel']]) });
        // Heuristics alone would say theme (cross-testament, 12 votes)
        expect(classifyEdge('Gen.1.27', 'Matt.19.4', 12, o)).toBe('parallel');
    });

    it('a chapter-pair overlay entry matches any verse in those chapters', () => {
        const o = overlay({ chapterPairs: new Map([['Isa.53→Acts.8', 'quotation']]) });
        expect(classifyEdge('Isa.53.7', 'Acts.8.32', 4, o)).toBe('quotation');
        expect(classifyEdge('Isa.53.12', 'Acts.8.35', 4, o)).toBe('quotation');
        expect(classifyEdge('Isa.54.1', 'Acts.8.32', 4, o)).toBe('keyword'); // different chapter - no overlay hit
    });

    it('promotes possible_allusion to allusion', () => {
        const o = overlay({ chapterPairs: new Map([['Ps.8→Heb.2', 'possible_allusion']]) });
        expect(classifyEdge('Ps.8.4', 'Heb.2.6', 3, o)).toBe('allusion');
    });

    it('falls through to heuristics on an overlay miss', () => {
        const o = overlay({ versePairs: new Map([['Gen.1.1→John.1.1', 'quotation']]) });
        expect(classifyEdge('Isa.7.14', 'Matt.1.23', 150, o)).toBe('allusion'); // Rule 3, not overlay
        expect(classifyEdge('Gen.12.1', 'Exod.3.1', 3, o)).toBe('keyword');
    });

    it('a chapter-level quotation needs the verse pair attested at 3 votes; weaker pairs are allusion', () => {
        const o = overlay({ chapterPairs: new Map([['Rev.18→Jer.51', 'quotation']]) });
        expect(classifyEdge('Rev.18.2', 'Jer.51.8', 3, o)).toBe('quotation');
        expect(classifyEdge('Rev.18.21', 'Jer.51.64', 2, o)).toBe('allusion');
    });

    it('a verse-level quotation holds at any vote count', () => {
        const o = overlay({ versePairs: new Map([['Luke.4.18→Isa.61.1', 'quotation']]) });
        expect(classifyEdge('Luke.4.18', 'Isa.61.1', 1, o)).toBe('quotation');
    });
});

describe('classifyEdge - golden pairs (issue #282)', () => {
    // Overlay state mirrors the real datasets for these pairs: UBS word-match
    // typing for the verse pairs, OT-NT-Reference-Map codes for the chapters.
    const o = overlay({
        versePairs: new Map([
            ['Luke.4.18→Isa.61.1', 'quotation'],   // 18 of 22 words match
            ['Mark.7.6→Isa.29.13', 'quotation'],   // 20 of 29
            ['Matt.8.17→Isa.53.4', 'allusion'],    // 0 of 18: Matthew renders the Hebrew himself
            ['Heb.11.5→Gen.5.24', 'allusion'],     // 8 of 23, longest run 4
        ]),
        chapterPairs: new Map([
            ['Matt.1→Isa.7', 'quotation'],
            ['Matt.8→Isa.53', 'quotation'],
            ['Heb.11→Gen.1', 'allusion'],
            ['1Pet.5→Ps.55', 'allusion'],
        ]),
    });
    const cases: Array<[string, string, number, string]> = [
        ['Luke.4.18', 'Isa.61.1', 299, 'quotation'],   // was allusion: UBS shadowed the vote rule
        ['Mark.7.6', 'Isa.29.13', 191, 'quotation'],
        ['Matt.1.23', 'Isa.7.14', 183, 'quotation'],   // curated chapter pair
        ['Matt.8.17', 'Isa.53.4', 96, 'quotation'],    // weak UBS match must not shadow the curated quotation
        ['Heb.11.5', 'Gen.5.24', 26, 'allusion'],
        ['Heb.11.3', 'Gen.1.1', 274, 'allusion'],      // curated allusion outranks 274 votes
        ['1Pet.5.7', 'Ps.55.22', 365, 'allusion'],
        ['John.3.16', 'Gen.22.12', 164, 'allusion'],   // was quotation: votes only
        ['Rom.8.28', 'Gen.50.20', 383, 'allusion'],
        ['Rom.8.29', 'Jer.1.5', 1154, 'allusion'],
        ['Phil.4.13', 'Isa.41.10', 1025, 'allusion'],
    ];
    for (const [a, b, votes, expected] of cases) {
        it(`${a} -> ${b} (${votes} votes) is ${expected}`, () => {
            expect(classifyEdge(a, b, votes, o)).toBe(expected);
        });
    }
});

describe('parseCrossReferences', () => {
    it('parses valid rows, orients them later -> earlier, and classifies them', () => {
        const records = parseCrossReferences(
            'From Verse\tTo Verse\tVotes\n' +
            'Gen.1.1\tJer.10.12\t72\n' +
            'Isa.7.14\tMatt.1.23\t150\n',
        );
        expect(records).toEqual([
            { id: 'Jer.10.12→Gen.1.1', sourceVerse: 'Jer.10.12', targetVerse: 'Gen.1.1', type: 'theme', votes: 72 },
            // The quoting NT verse is the source even though the row listed it
            // from Isaiah; without an overlay the votes make it an allusion
            { id: 'Matt.1.23→Isa.7.14', sourceVerse: 'Matt.1.23', targetVerse: 'Isa.7.14', type: 'allusion', votes: 150 },
        ]);
    });

    it('normalizes target ranges to the start verse', () => {
        const [rec] = parseCrossReferences('Gen.1.1\tCol.1.16-Col.1.17\t161\n');
        expect(rec.sourceVerse).toBe('Col.1.16');
        expect(rec.targetVerse).toBe('Gen.1.1');
        expect(rec.id).toBe('Col.1.16→Gen.1.1');
    });

    it('merges mirror rows onto one pair with the max votes and a single type (issue #183)', () => {
        const records = parseCrossReferences(
            'Gen.1.1\tJer.10.12\t77\n' +
            'Exod.20.8\tGen.2.2\t5\n' +
            'Jer.10.12\tGen.1.1\t11\n' +
            'Gen.2.2\tExod.20.8\t40\n',
        );
        expect(records).toEqual([
            // First mention fixes output order; votes and type come from the stronger side
            { id: 'Jer.10.12→Gen.1.1', sourceVerse: 'Jer.10.12', targetVerse: 'Gen.1.1', type: 'theme', votes: 77 },
            { id: 'Exod.20.8→Gen.2.2', sourceVerse: 'Exod.20.8', targetVerse: 'Gen.2.2', type: 'theme', votes: 40 },
        ]);
    });

    it('a mirror row below the positive-vote floor neither adds nor removes the pair', () => {
        const records = parseCrossReferences(
            'Gen.1.1\tJer.10.12\t77\n' +
            'Jer.10.12\tGen.1.1\t-3\n',
        );
        expect(records).toHaveLength(1);
        expect(records[0].votes).toBe(77);
    });

    it('skips headers, comments, blanks, and malformed lines', () => {
        const records = parseCrossReferences(
            '# comment\n' +
            'From Verse\tTo Verse\tVotes\n' +
            '\n' +
            'Gen.1.1\t50\n' +               // too few columns
            'NotAVerse\tGen.1.1\t10\n' +    // invalid source ref
            'Gen.1.1\tGen.2.1\tabc\n' +     // non-numeric votes
            'Gen.1.1\tGen.2.1\t7\n',
        );
        expect(records).toHaveLength(1);
        expect(records[0].id).toBe('Gen.2.1→Gen.1.1');
    });

    it('skips self-references and non-positive votes', () => {
        const records = parseCrossReferences(
            'Gen.1.1\tGen.1.1\t50\n' +
            'Gen.1.1\tGen.2.1\t0\n' +
            'Gen.1.1\tGen.3.1\t-4\n',
        );
        expect(records).toHaveLength(0);
    });

    it('collapses same-direction duplicates onto the pair with the max votes', () => {
        const records = parseCrossReferences(
            'Gen.1.1\tGen.2.1\t7\n' +
            'Gen.1.1\tGen.2.1-Gen.2.3\t99\n', // same pair after range normalization
        );
        expect(records).toHaveLength(1);
        expect(records[0].id).toBe('Gen.2.1→Gen.1.1');
        expect(records[0].votes).toBe(99);
    });

    it('applies the typed overlay when provided', () => {
        const o = overlay({ versePairs: new Map([['Gen.1.27→Matt.19.4', 'allusion']]) });
        const [rec] = parseCrossReferences('Gen.1.27\tMatt.19.4\t2\n', o);
        expect(rec.type).toBe('allusion'); // heuristics alone would say theme
    });
});
