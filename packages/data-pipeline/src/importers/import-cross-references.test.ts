import { describe, it, expect } from 'vitest';
import { normalizeVerse, classifyEdge, parseCrossReferences } from './import-cross-references.js';
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

describe('classifyEdge - structural heuristics (Tier 2)', () => {
    it('quotation: cross-testament with votes ≥ 100, both directions', () => {
        expect(classifyEdge('Isa.7.14', 'Matt.1.23', 150, null)).toBe('quotation');
        expect(classifyEdge('Matt.1.23', 'Isa.7.14', 100, null)).toBe('quotation');
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
        expect(classifyEdge('Isa.7.14', 'Matt.1.23', 150, o)).toBe('quotation'); // via Rule 1, not overlay
        expect(classifyEdge('Gen.12.1', 'Exod.3.1', 3, o)).toBe('keyword');
    });
});

describe('parseCrossReferences', () => {
    it('parses valid rows and classifies them', () => {
        const records = parseCrossReferences(
            'From Verse\tTo Verse\tVotes\n' +
            'Gen.1.1\tJer.10.12\t72\n' +
            'Isa.7.14\tMatt.1.23\t150\n',
        );
        expect(records).toEqual([
            { id: 'Gen.1.1→Jer.10.12', sourceVerse: 'Gen.1.1', targetVerse: 'Jer.10.12', type: 'theme', votes: 72 },
            { id: 'Isa.7.14→Matt.1.23', sourceVerse: 'Isa.7.14', targetVerse: 'Matt.1.23', type: 'quotation', votes: 150 },
        ]);
    });

    it('normalizes target ranges to the start verse', () => {
        const [rec] = parseCrossReferences('Gen.1.1\tCol.1.16-Col.1.17\t161\n');
        expect(rec.targetVerse).toBe('Col.1.16');
        expect(rec.id).toBe('Gen.1.1→Col.1.16');
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
        expect(records[0].id).toBe('Gen.1.1→Gen.2.1');
    });

    it('skips self-references and non-positive votes', () => {
        const records = parseCrossReferences(
            'Gen.1.1\tGen.1.1\t50\n' +
            'Gen.1.1\tGen.2.1\t0\n' +
            'Gen.1.1\tGen.3.1\t-4\n',
        );
        expect(records).toHaveLength(0);
    });

    it('deduplicates by source→target pair, keeping the first row', () => {
        const records = parseCrossReferences(
            'Gen.1.1\tGen.2.1\t7\n' +
            'Gen.1.1\tGen.2.1-Gen.2.3\t99\n', // same pair after range normalization
        );
        expect(records).toHaveLength(1);
        expect(records[0].votes).toBe(7);
    });

    it('applies the typed overlay when provided', () => {
        const o = overlay({ versePairs: new Map([['Gen.1.27→Matt.19.4', 'allusion']]) });
        const [rec] = parseCrossReferences('Gen.1.27\tMatt.19.4\t2\n', o);
        expect(rec.type).toBe('allusion'); // heuristics alone would say theme
    });
});
