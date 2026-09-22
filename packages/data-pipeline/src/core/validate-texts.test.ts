import { describe, it, expect } from 'vitest';
import { BOOKS } from '@codex-scriptura/core';
import { validateTranslation, alignmentProblems, unexpectedDetachedPunctuation, CANONICAL_CHAPTERS, EXPECTED_BOOKS, KNOWN_TITLE_LEMMA_LEAKS, type ValidationVerse, type ValidationReport } from './validate-texts.js';

/**
 * Fixtures for a real translation id are deliberately partial, so the
 * whole-book baseline fires for every book they leave out. These helpers
 * set that invariant aside where a test is about something else.
 */
const errs = (r: ValidationReport) => r.errors.filter((e) => !e.includes('is absent from the output'));
const checks = (r: ValidationReport) => r.checks.filter((c) => c.id !== 'missing-book');

function v(
    book: string,
    chapter: number,
    verse: number,
    extra: Partial<ValidationVerse> = {},
): ValidationVerse {
    return {
        book,
        chapter,
        verse,
        osisId: `${book}.${chapter}.${verse}`,
        text: 'text',
        ...extra,
    };
}

describe('validateTranslation - clean data', () => {
    // Single-chapter books (2John: 13 verses, Obad: 21) keep these fixtures
    // free of missing-chapter warnings, and running to the chapter's full
    // reference count keeps them free of trailing-verse warnings.
    it('passes contiguous verses with no findings', () => {
        const verses = Array.from({ length: 13 }, (_, i) => v('2John', 1, i + 1));
        const r = validateTranslation('T', verses);
        expect(errs(r)).toEqual([]);
        expect(r.warnings).toEqual([]);
        expect(r.expectedOmissions).toEqual([]);
        expect(r.verseCount).toBe(13);
        expect(r.bookCount).toBe(1);
    });

    it('treats a bridge as covering its full range', () => {
        const r = validateTranslation('T', [
            v('Obad', 1, 1),
            v('Obad', 1, 2, { verseEnd: 20 }),
            v('Obad', 1, 21),
        ]);
        expect(errs(r)).toEqual([]);
        expect(r.warnings).toEqual([]);
    });
});

describe('validateTranslation - hard errors', () => {
    it('flags duplicate osisIds', () => {
        const r = validateTranslation('T', [v('Gen', 1, 1), v('Gen', 1, 1)]);
        expect(r.errors.some((e) => e.includes('duplicate'))).toBe(true);
    });

    it('flags unknown book IDs', () => {
        const r = validateTranslation('T', [v('Nope', 1, 1)]);
        expect(r.errors.some((e) => e.includes("unknown book 'Nope'"))).toBe(true);
    });

    it('flags empty text', () => {
        const r = validateTranslation('T', [v('Gen', 1, 1, { text: '  ' })]);
        expect(r.errors.some((e) => e.includes('empty text'))).toBe(true);
    });

    it('flags inverted bridges', () => {
        const r = validateTranslation('T', [v('Gen', 1, 5, { verseEnd: 5 })]);
        expect(r.errors.some((e) => e.includes('inverted bridge'))).toBe(true);
    });

    it('flags a bridge overlapping an explicit verse', () => {
        const r = validateTranslation('T', [
            v('Gen', 1, 1, { verseEnd: 3 }),
            v('Gen', 1, 2),
        ]);
        expect(r.errors.some((e) => e.includes('overlaps'))).toBe(true);
    });

    it('flags chapter numbers beyond the canon', () => {
        const r = validateTranslation('T', [v('Jude', 2, 1)]);
        expect(r.errors.some((e) => e.includes('has chapter 2'))).toBe(true);
    });

    it('flags an empty dataset instead of passing it', () => {
        const r = validateTranslation('T', []);
        expect(r.errors.some((e) => e.includes('no verse records'))).toBe(true);
    });

    it('flags chapter 0, negative, and non-integer chapter numbers', () => {
        for (const chapter of [0, -3, 1.5]) {
            const r = validateTranslation('T', [v('Gen', chapter, 1)]);
            expect(r.errors.some((e) => e.includes('invalid chapter number'))).toBe(true);
            expect(r.warnings).toEqual([]);
        }
    });
});

describe('validateTranslation - warnings vs expected omissions', () => {
    it('fails on an unexpected verse gap - a dropped verse is a hard error (issue #177 class)', () => {
        // 2 John 1–13 with verse 2 missing: exactly one interior gap
        const verses = Array.from({ length: 13 }, (_, i) => v('2John', 1, i + 1))
            .filter((x) => x.verse !== 2);
        const r = validateTranslation('T', verses);
        expect(errs(r)).toEqual(['T: verse gap at 2John.1.2']);
        expect(r.warnings).toEqual([]);
        expect(r.checks).toEqual([{ id: 'verse-gap', severity: 'error', count: 1 }]);
    });

    it('classifies known critical-text omissions as expected, not warnings', () => {
        // Acts 8:37 is a classic critical-text omission. The fixture's other
        // gaps (verses 1–35) correctly warn - the point is that 8:37 doesn't.
        const r = validateTranslation('OEB', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r.warnings.some((w) => w.includes('Acts.8.37'))).toBe(false);
        expect(r.expectedOmissions).toEqual(['Acts.8.37']);
    });

    it('keys expected omissions per translation - the same gap fails in the KJV', () => {
        // The KJV contains Acts 8:37, so a gap there is an importer bug.
        const r = validateTranslation('KJV', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r.errors).toContain('KJV: verse gap at Acts.8.37');
        expect(r.expectedOmissions).toEqual([]);
    });

    it('does not excuse NT omissions the WEB retains', () => {
        // WEB omits only 4 NT disputed verses; Matt 17:21 is kept in place,
        // so a gap there must fail even though the OEB legitimately omits it.
        const r = validateTranslation('WEB', [v('Matt', 17, 20), v('Matt', 17, 22)]);
        expect(r.errors).toContain('WEB: verse gap at Matt.17.21');
        const r2 = validateTranslation('WEB', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r2.expectedOmissions).toEqual(['Acts.8.37']);
    });

    it('treats every gap as an error for translations with no known-gaps entry', () => {
        const r = validateTranslation('NEW', [v('Acts', 8, 36), v('Acts', 8, 38)]);
        expect(r.errors).toContain('NEW: verse gap at Acts.8.37');
        expect(r.expectedOmissions).toEqual([]);
    });

    it('warns on missing chapters for normal books (partial translations)', () => {
        // Two complete chapters (Ps 1 has 6 verses, Ps 3 has 8) with the rest of the book absent
        const verses = [
            ...Array.from({ length: 6 }, (_, i) => v('Ps', 1, i + 1)),
            ...Array.from({ length: 8 }, (_, i) => v('Ps', 3, i + 1)),
        ];
        const r = validateTranslation('T', verses);
        expect(errs(r)).toEqual([]);
        expect(r.warnings).toEqual(['T: Ps missing 148 chapter(s): 2, 4–150']);
        expect(r.checks).toEqual([{ id: 'missing-chapters', severity: 'warning', count: 1 }]);
    });
});

describe('validateTranslation - trailing-verse check (known-issues #24)', () => {
    // 2 John has 13 verses in the KJV reference table.
    const twoJohn = (last: number) =>
        Array.from({ length: last }, (_, i) => v('2John', 1, i + 1));

    it('fails when a chapter ends short of the reference count', () => {
        const r = validateTranslation('T', twoJohn(12));
        expect(r.warnings).toEqual([]);
        expect(errs(r)).toEqual([
            'T: trailing verse gap at 2John.1.13 (chapter ends at 12, reference versification has 13)',
        ]);
        expect(r.checks).toEqual([{ id: 'trailing-gap', severity: 'error', count: 1 }]);
    });

    it('passes a chapter that reaches the reference count', () => {
        const r = validateTranslation('T', twoJohn(13));
        expect(r.warnings).toEqual([]);
    });

    it('classifies known trailing omissions as expected (WEB Romans doxology)', () => {
        const rom16 = Array.from({ length: 24 }, (_, i) => v('Rom', 16, i + 1));
        const r = validateTranslation('WEB', rom16);
        expect(r.expectedOmissions).toEqual(['Rom.16.25', 'Rom.16.26', 'Rom.16.27']);
        expect(errs(r)).toEqual([]);
    });

    it('warns when a chapter runs past the reference count', () => {
        const rev12 = Array.from({ length: 18 }, (_, i) => v('Rev', 12, i + 1));
        const r = validateTranslation('KJV', rev12);
        expect(r.warnings.some((w) => w.includes('Rev.12 runs to verse 18'))).toBe(true);
        expect(checks(r).map((c) => `${c.id}:${c.severity}`)).toEqual(['missing-chapters:warning', 'verse-overrun:warning']);
    });

    it('accepts per-translation verse-count variants (OEB Rev 12:18)', () => {
        const rev12 = Array.from({ length: 18 }, (_, i) => v('Rev', 12, i + 1));
        const r = validateTranslation('OEB', rev12);
        expect(r.warnings.some((w) => w.includes('Rev.12'))).toBe(false);
    });

    it('skips books absent from the reference table', () => {
        // 3Macc is WEB-only - no KJV reference counts exist for it
        const r = validateTranslation('WEB', [v('3Macc', 1, 1)]);
        expect(r.errors.some((w) => w.includes('trailing'))).toBe(false);
    });

    it('fails a bridge that runs past the reference count', () => {
        // 2 John has 13 verses; a 12–15 bridge claims verses that do not exist
        const r = validateTranslation('T', [...twoJohn(11), v('2John', 1, 12, { verseEnd: 15 })]);
        expect(r.errors).toContain('T: bridge 2John.1.12 runs to verse 15 but the reference versification has 13');
        expect(r.checks.map((c) => c.id)).toEqual(['bridge-range', 'verse-overrun']);
    });
});

describe('validateTranslation - versification variants', () => {
    it('accepts EpJer numbered as Baruch 6', () => {
        // Full chapter (73 verses in the reference table) so the trailing
        // check stays quiet - the point here is the chapter numbering
        const verses = Array.from({ length: 73 }, (_, i) => v('EpJer', 6, i + 1));
        const r = validateTranslation('T', verses);
        expect(errs(r)).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it('accepts AddPs numbered as Psalm 151', () => {
        const r = validateTranslation('T', [v('AddPs', 151, 1)]);
        expect(errs(r)).toEqual([]);
        expect(r.warnings).toEqual([]);
    });

    it('suppresses missing-chapter warnings for sparse-numbered books', () => {
        // KJV Greek Esther spans chapters 10–16 only, starting at 10:4;
        // chapter 10 runs to its full reference count (13)
        const verses = Array.from({ length: 10 }, (_, i) => v('AddEsth', 10, i + 4));
        const r = validateTranslation('KJV', verses);
        expect(r.warnings).toEqual([]);
        expect(r.expectedOmissions).toEqual(['AddEsth.10.1', 'AddEsth.10.2', 'AddEsth.10.3']);
    });
});

// ─── Issue #321 corpus invariants ─────────────────────────

const twoJohnFull = () => Array.from({ length: 13 }, (_, i) => v('2John', 1, i + 1));
const withVerseOne = (extra: Partial<ValidationVerse>) =>
    twoJohnFull().map((x) => (x.verse === 1 ? { ...x, ...extra } : x));

describe('canon table', () => {
    it('is derived from core BOOKS, so an importer cannot strand a book the client does not know (issue #177)', () => {
        expect(Object.keys(CANONICAL_CHAPTERS).sort()).toEqual(BOOKS.map((b) => b.osisId).sort());
        expect(CANONICAL_CHAPTERS.AddEsth).toBe(16);
        expect(CANONICAL_CHAPTERS['4Macc']).toBe(18);
    });
});

describe('markup residue', () => {
    it.each([
        ['a leaked tag', 'said <w lemma="x">he</w> to'],
        ['a leaked closing tag', 'said he</note> to'],
        ['an undecoded entity', 'God &amp; man'],
        ['a numeric entity', 'God &#8217;s man'],
        ['a USFM marker', 'said \\f + note \\f* to'],
    ])('fails on %s', (_label, text) => {
        const r = validateTranslation('T', withVerseOne({ text }));
        expect(r.checks).toEqual([{ id: 'markup-residue', severity: 'error', count: 1 }]);
    });

    it('passes scripture with apostrophes, quotes and bare comparison signs', () => {
        const r = validateTranslation('T', withVerseOne({ text: '“The Lord’s” said he: 2 < 3 and 5 > 4; Sarah & Abraham' }));
        expect(errs(r)).toEqual([]);
    });
});

describe('detached punctuation (issue #175)', () => {
    it.each([
        ['a comma', 'For, said she , God hath appointed'],
        ['a period', 'the end .'],
        ['a question mark', 'who hath come into her treasures ?'],
        ['a colon', 'bless ye the Lord : praise'],
    ])('fails on a space before %s', (_label, text) => {
        const r = validateTranslation('T', withVerseOne({ text }));
        expect(errs(r)).toHaveLength(1);
        expect(r.errors[0]).toMatch(/detached punctuation in 2John\.1\.1/);
    });

    it.each([
        ['an ellipsis after a comma (DBY)', 'and say, ...and blow the trumpet'],
        ['a lone ellipsis', 'called his name Seth ... For God'],
        ['punctuation after a dash (YLT)', 'If they come in unto My rest — !'],
        ['punctuation after a closing quote (OEB)', '‘Your son is living’ ; and he himself'],
        ['punctuation after a double quote', '“I tell you” , he said'],
    ])('accepts %s', (_label, text) => {
        expect(errs(validateTranslation('T', withVerseOne({ text })))).toEqual([]);
    });

    it('excuses source-inherent cases only for the translation that carries them', () => {
        const bar = [v('Bar', 3, 15, { text: 'who hath come into her treasures ?' })];
        expect(validateTranslation('KJV', bar).errors.some((e) => e.includes('detached'))).toBe(false);
        expect(validateTranslation('WEB', bar).errors.some((e) => e.includes('detached'))).toBe(true);
    });

    it('excuses the known typo itself, not the whole verse', () => {
        // Known typo present: pass. A second detached mark elsewhere in the same verse: fail.
        const known = [v('Bar', 3, 15, { text: 'Who hath found out her place ? or who hath come into her treasures ?' })];
        const r = validateTranslation('KJV', known);
        expect(r.errors.filter((e) => e.includes('detached'))).toEqual(['KJV: detached punctuation in Bar.3.15: "place ?"']);
        // The known occurrence budget is one: the same typo twice is one surplus
        expect(unexpectedDetachedPunctuation('treasures ? and treasures ?', ['treasures ?'])).toEqual(['treasures ?']);
        expect(unexpectedDetachedPunctuation('treasures ? and treasures ?', ['treasures ?', 'treasures ?'])).toEqual([]);
        // A different mark after the same word is not the known typo
        expect(unexpectedDetachedPunctuation('her treasures ,', ['treasures ?'])).toEqual(['treasures ,']);
    });
});

describe('Psalm superscriptions in verse 1 (issue #176 class)', () => {
    const ps4 = (extra: Partial<ValidationVerse>) =>
        Array.from({ length: 8 }, (_, i) => v('Ps', 4, i + 1)).map((x) => (x.verse === 1 ? { ...x, ...extra } : x));

    it.each(['To the chief Musician on Neginoth, A Psalm of David. Hear me', 'A Psalm of David. Jehovah, who', 'For the choirmaster. With stringed instruments.'])(
        'fails on title text opening verse 1: %s', (text) => {
            const r = validateTranslation('ASV', ps4({ text }));
            expect(errs(r)).toEqual([`ASV: superscription text in Ps.4.1: "${text.slice(0, 40)}"`]);
            expect(checks(r).filter((c) => c.severity === 'error')).toEqual([{ id: 'psalm-title-text', severity: 'error', count: 1 }]);
        });

    it('lets the YLT keep titles in verse 1, where its source numbers them', () => {
        expect(errs(validateTranslation('YLT', ps4({ text: 'A Psalm of David. Jehovah, who' })))).toEqual([]);
    });

    it('does not mistake a body verse that mentions a psalm for a title', () => {
        expect(errs(validateTranslation('ASV', ps4({ text: 'Sing unto him a new song; a psalm of praise' })))).toEqual([]);
    });

    it('fails on superscription lemmas in verse 1 (mizmor, lamnatseach, michtam, maskil, shiggaion)', () => {
        for (const token of ['H4210', 'H5329', 'H4387', 'H4905', 'H7692']) {
            const r = validateTranslation('WEB', ps4({ lemmas: `H430 ${token}` }));
            expect(errs(r)).toEqual([`WEB: superscription lemma(s) in Ps.4.1: ${token}`]);
        }
    });

    it('accepts the same tokens outside verse 1 and outside Psalms', () => {
        expect(errs(validateTranslation('WEB', ps4({}).map((x) => (x.verse === 2 ? { ...x, lemmas: 'H4210' } : x))))).toEqual([]);
        expect(errs(validateTranslation('WEB', withVerseOne({ lemmas: 'H4210' })))).toEqual([]);
    });

    it('excuses eBible\'s source-tagged verse-1 records for ASV and BSB only', () => {
        expect(KNOWN_TITLE_LEMMA_LEAKS.ASV['Ps.4.1']).toEqual(new Set(['H4210', 'H5329']));
        expect(errs(validateTranslation('ASV', ps4({ lemmas: 'H430 H4210 H5329' })))).toEqual([]);
        expect(errs(validateTranslation('DBY', ps4({ lemmas: 'H430 H4210' })))).toHaveLength(1);
        // An unlisted Psalm still fails for ASV: the allowlist is per ref, not per translation
        const ps5 = Array.from({ length: 12 }, (_, i) => v('Ps', 5, i + 1)).map((x) => (x.verse === 1 ? { ...x, lemmas: 'H4210' } : x));
        expect(errs(validateTranslation('ASV', ps5))).toHaveLength(1);
    });

    it('excuses the known token itself, not every title token in a listed Psalm', () => {
        // ASV Ps 4:1 is known to carry H4210 and H5329; michtam and shiggaion there would be new
        const r = validateTranslation('ASV', ps4({ lemmas: 'H430 H4210 H4387 H7692' }));
        expect(errs(r)).toEqual(['ASV: superscription lemma(s) in Ps.4.1: H4387 H7692']);
        // BSB Ps 4:1 is known for H4210 only; ASV's H5329 there is a new leak for BSB
        expect(errs(validateTranslation('BSB', ps4({ lemmas: 'H430 H4210 H5329' })))).toEqual(['BSB: superscription lemma(s) in Ps.4.1: H5329']);
    });
});

describe('lemma tokens', () => {
    it.each(['strong:H7225', 'H07225', 'H0', 'h7225', 'H123456', 'G25a'])('fails on the unnormalized token %s', (token) => {
        const r = validateTranslation('T', withVerseOne({ lemmas: `H430 ${token}` }));
        expect(errs(r)).toEqual([`T: malformed lemma token(s) in 2John.1.1: ${token}`]);
    });

    it('accepts normalized Hebrew and Greek tokens', () => {
        expect(errs(validateTranslation('T', withVerseOne({ lemmas: 'H1 H7225 G25 G99999' })))).toEqual([]);
    });
});

describe('alignment spans', () => {
    const text = 'In the beginning God created';
    const good = { text, lemmas: 'H7225 H430 H1254', align: '[[7,16,"H7225"],[17,20,"H430"],[21,28,"H1254"]]' };

    it('accepts well-formed, ordered spans whose tokens are in the lemma bag', () => {
        expect(alignmentProblems({ ...v('Gen', 1, 1), ...good })).toEqual([]);
        expect(errs(validateTranslation('T', withVerseOne(good)))).toEqual([]);
    });

    it.each([
        ['a span past the end of the text', '[[21,40,"H1254"]]', /outside text/],
        ['an inverted span', '[[16,7,"H7225"]]', /outside text/],
        ['overlapping spans', '[[7,16,"H7225"],[10,20,"H430"]]', /overlaps or precedes/],
        ['out-of-order spans', '[[17,20,"H430"],[7,16,"H7225"]]', /overlaps or precedes/],
        ['edge whitespace', '[[6,16,"H7225"]]', /edge whitespace/],
        ['a token missing from lemmas', '[[7,16,"H9999"]]', /H9999 is not in the verse's lemmas/],
        ['a malformed span', '[[7,16]]', /malformed span/],
        ['invalid JSON', '[[7,16,"H7225"', /not valid JSON/],
        ['a non-array', '{"a":1}', /not an array/],
    ])('fails on %s', (_label, align, pattern) => {
        const problems = alignmentProblems({ ...v('Gen', 1, 1), ...good, align });
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(pattern);
        const r = validateTranslation('T', withVerseOne({ ...good, align }));
        expect(r.checks).toEqual([{ id: 'alignment', severity: 'error', count: 1 }]);
    });

    it('requires lemmas on an aligned verse', () => {
        expect(alignmentProblems({ ...v('Gen', 1, 1), text, align: '[[7,16,"H7225"]]' })).toEqual([
            "Gen.1.1: aligned H7225 is not in the verse's lemmas",
        ]);
    });
});

describe('report shape', () => {
    it('counts verses per book and lists each invariant that fired with its severity', () => {
        const verses = [...twoJohnFull(), v('Obad', 1, 1, { text: 'bad ,' }), v('Obad', 1, 3)];
        const r = validateTranslation('T', verses);
        expect(r.books).toEqual({ '2John': 13, Obad: 2 });
        expect(r.checks).toEqual([
            { id: 'detached-punctuation', severity: 'error', count: 1 },
            { id: 'trailing-gap', severity: 'error', count: 18 },
            { id: 'verse-gap', severity: 'error', count: 1 },
        ]);
        expect(errs(r)).toHaveLength(20);
    });

    it('reports no checks for a clean translation', () => {
        expect(validateTranslation('T', twoJohnFull()).checks).toEqual([]);
    });
});

describe('expected books (whole-book loss)', () => {
    const full = (book: string, chapter: number, count: number) => Array.from({ length: count }, (_, i) => v(book, chapter, i + 1));
    /** Every expected book of `translation` as one complete first chapter, minus `drop`. */
    const corpus = (translation: string, drop: string[] = []) =>
        [...EXPECTED_BOOKS[translation]]
            .filter((b) => !drop.includes(b))
            .flatMap((b) => {
                const chapter = b === 'EpJer' ? 6 : b === 'AddPs' ? 151 : 1;
                const count = ({ EpJer: 73, AddPs: 7, AddEsth: 13, '3Macc': 29, '4Macc': 35 } as Record<string, number>)[b]
                    ?? (validateTranslation('T', [v(b, chapter, 1)]).errors.find((e) => e.includes('trailing'))?.match(/reference versification has (\d+)/)?.[1] ?? '1');
                return full(b, chapter, Number(count));
            });

    it('records what each pinned source is known to contain', () => {
        expect(EXPECTED_BOOKS.KJV.size).toBe(80);
        expect(EXPECTED_BOOKS.WEB.size).toBe(83);
        expect(EXPECTED_BOOKS.OEB.size).toBe(42);
        expect(EXPECTED_BOOKS.ASV.size).toBe(66);
        expect(EXPECTED_BOOKS.WEB.has('4Macc')).toBe(true);
        expect(EXPECTED_BOOKS.KJV.has('4Macc')).toBe(false);
        expect(EXPECTED_BOOKS.OEB.has('Gen')).toBe(false);
    });

    it('fails when an expected book is entirely absent (WEB without 4 Maccabees)', () => {
        const r = validateTranslation('WEB', corpus('WEB', ['4Macc']));
        expect(r.errors.filter((e) => e.includes('absent'))).toEqual(['WEB: expected book 4Macc is absent from the output']);
        expect(r.checks.find((c) => c.id === 'missing-book')).toEqual({ id: 'missing-book', severity: 'error', count: 1 });
    });

    it('fails when a KJV Apocrypha book vanishes, and names every missing book', () => {
        const r = validateTranslation('KJV', corpus('KJV', ['PrMan', '2Esd']));
        expect(r.errors.filter((e) => e.includes('absent'))).toEqual([
            'KJV: expected book 2Esd is absent from the output',
            'KJV: expected book PrMan is absent from the output',
        ]);
    });

    it('does not demand the Protestant 66 of a partial translation (OEB)', () => {
        const r = validateTranslation('OEB', corpus('OEB'));
        expect(r.errors.filter((e) => e.includes('absent'))).toEqual([]);
        expect(validateTranslation('OEB', corpus('OEB', ['Ruth'])).errors).toContain('OEB: expected book Ruth is absent from the output');
    });

    it('makes no book demands of a translation without a baseline', () => {
        expect(errs(validateTranslation('NEW', [v('Jude', 1, 1, { verseEnd: 25 })]))).toEqual([]);
    });
});
