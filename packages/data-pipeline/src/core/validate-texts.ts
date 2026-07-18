/**
 * Versification validation for imported translation texts.
 *
 * Catches the class of pipeline bug that silently corrupts scripture data:
 * dropped verses (the verse-bridge regex bug), duplicated records, note
 * content masquerading as verses, and structural drift between imports.
 *
 * Pure logic - the CLI wrapper lives in src/validate-texts.ts.
 */

import { KJV_VERSE_COUNTS } from './kjv-versification.js';

// ─── Canonical chapter counts ─────────────────────────────
// Mirrored from @codex-scriptura/core BOOKS (this package re-declares
// rather than imports core - see core/types.ts). Keep in sync when the
// canon list changes.
export const CANONICAL_CHAPTERS: Record<string, number> = {
    'Gen': 50,
    'Exod': 40,
    'Lev': 27,
    'Num': 36,
    'Deut': 34,
    'Josh': 24,
    'Judg': 21,
    'Ruth': 4,
    '1Sam': 31,
    '2Sam': 24,
    '1Kgs': 22,
    '2Kgs': 25,
    '1Chr': 29,
    '2Chr': 36,
    'Ezra': 10,
    'Neh': 13,
    'Esth': 10,
    'Job': 42,
    'Ps': 150,
    'Prov': 31,
    'Eccl': 12,
    'Song': 8,
    'Isa': 66,
    'Jer': 52,
    'Lam': 5,
    'Ezek': 48,
    'Dan': 12,
    'Hos': 14,
    'Joel': 3,
    'Amos': 9,
    'Obad': 1,
    'Jonah': 4,
    'Mic': 7,
    'Nah': 3,
    'Hab': 3,
    'Zeph': 3,
    'Hag': 2,
    'Zech': 14,
    'Mal': 4,
    'Tob': 14,
    'Jdt': 16,
    'EsthGr': 16,
    'AddEsth': 16,
    'Wis': 19,
    'Sir': 51,
    'Bar': 6,
    'EpJer': 1,
    'PrAzar': 1,
    'Sus': 1,
    'Bel': 1,
    '1Macc': 16,
    '2Macc': 15,
    '1Esd': 9,
    '2Esd': 16,
    'PrMan': 1,
    'AddPs': 1,
    '3Macc': 7,
    '4Macc': 18,
    'Matt': 28,
    'Mark': 16,
    'Luke': 24,
    'John': 21,
    'Acts': 28,
    'Rom': 16,
    '1Cor': 16,
    '2Cor': 13,
    'Gal': 6,
    'Eph': 6,
    'Phil': 4,
    'Col': 4,
    '1Thess': 5,
    '2Thess': 3,
    '1Tim': 6,
    '2Tim': 4,
    'Titus': 3,
    'Phlm': 1,
    'Heb': 13,
    'Jas': 5,
    '1Pet': 5,
    '2Pet': 3,
    '1John': 5,
    '2John': 1,
    '3John': 1,
    'Jude': 1,
    'Rev': 22,
};

// ─── Versification variants ───────────────────────────────
// Books whose traditional chapter numbering differs from a simple 1..N:
//   - EpJer is printed as Baruch 6 (sources number it chapter 6)
//   - AddPs is Psalm 151 (sources number it chapter 151)
// The value is the maximum chapter number the source may legitimately use.
export const VARIANT_MAX_CHAPTER: Record<string, number> = {
    'EpJer': 6,
    'AddPs': 151,
};

// Books where missing chapters are expected source versification, not data
// loss: EpJer/AddPs carry a single high-numbered chapter (above); Greek
// Esther additions (EsthGr/AddEsth) span sparse chapter ranges (KJV has
// 10–16 starting at 10:4; WEB has 1–10); Baruch lacks chapter 6 because it
// is split out as EpJer. Missing-chapter warnings are suppressed for these.
export const SPARSE_CHAPTER_BOOKS = new Set<string>([
    'EpJer', 'AddPs', 'EsthGr', 'AddEsth', 'Bar',
]);

// ─── Known verse-number gaps ──────────────────────────────
// Verse numbers legitimately absent from our source texts, keyed by
// translation ID (uppercase, matching the *-verses.json filename stem).
// Two causes, both verified against the source XML during the 2026-07
// review:
//   1. Text-critical omissions - translations following modern critical
//      texts (NA/UBS; "the best authorities" for Sirach) omit verses the
//      KJV/TR numbering includes. In the sources these positions carry
//      only an omission footnote, which the importers correctly drop.
//   2. Source versification skips - the source's own numbering jumps
//      (e.g. WEB Greek Esther 9:4 → 9:6; KJV Greek Esther starts at 10:4).
// Gaps at these refs are reported as expected omissions, not warnings -
// but only for the translation(s) whose source actually omits them. The
// KJV contains Acts 8:37 etc., so a KJV gap there is an importer bug and
// must warn; likewise WEB retains most disputed NT verses (bracketed or
// footnoted in place) and omits only four. A translation with no entry
// here gets an empty set: every gap warns until its omissions are
// source-verified and added.
//
// Gaps at a chapter's *end* (invisible to gap analysis) are caught by the
// trailing-verse check against KJV_VERSE_COUNTS / the per-translation
// KNOWN_VERSE_COUNT_VARIANTS below, and classified through this same list
// (fixed known-issues #24 - e.g. WEB Sir 20:32, Rom 16:25–27).

// NT critical-text omissions - the full NA/UBS set, as omitted by the OEB.
const NT_CRITICAL_OMISSIONS = [
    'Matt.17.21', 'Matt.18.11', 'Matt.23.14',
    'Mark.7.16', 'Mark.9.44', 'Mark.9.46', 'Mark.11.26', 'Mark.15.28',
    'Luke.17.36', 'Luke.22.20', 'Luke.23.17', 'Luke.24.12', 'Luke.24.40',
    'John.5.4',
    'Acts.8.37', 'Acts.15.34', 'Acts.24.7', 'Acts.28.29',
    'Rom.16.24',
];

// ASV and BSB omit 16 of the 19 (both retain Luke 22:20, 24:12, 24:40).
// Source-verified 2026-07-18: ASV carries omission footnotes at these
// positions ("Some ancient authorities insert..."); BSB has no verse
// markers there at all.
const ASV_BSB_OMISSIONS = NT_CRITICAL_OMISSIONS.filter(
    (r) => !['Luke.22.20', 'Luke.24.12', 'Luke.24.40'].includes(r),
);

export const KNOWN_VERSE_GAPS: Record<string, ReadonlySet<string>> = {
    KJV: new Set([
        // Greek Esther - additions begin at 10:4 by design
        'EsthGr.10.1', 'EsthGr.10.2', 'EsthGr.10.3',
    ]),
    OEB: new Set(NT_CRITICAL_OMISSIONS),
    ASV: new Set(ASV_BSB_OMISSIONS),
    BSB: new Set(ASV_BSB_OMISSIONS),
    // Darby omits only these three; no markers in the source (verified 2026-07-18)
    DBY: new Set(['Matt.23.14', 'Acts.8.37', 'Acts.15.34']),
    // YLT matches KJV versification exactly (31,102 verses, zero gaps)
    WEB: new Set([
        // The only NT critical-text omissions in the WEB source - the
        // rest of the NA/UBS set is retained in place with footnotes
        'Luke.17.36', 'Acts.8.37', 'Acts.15.34', 'Acts.24.7',
        // Romans doxology: WEB places it at 14:24–26 (see
        // KNOWN_VERSE_COUNT_VARIANTS) and ends Romans 16 at verse 24 with
        // a footnote noting the TR numbers these verses 16:25–27
        'Rom.16.25', 'Rom.16.26', 'Rom.16.27',
        // Trailing "omitted by the best authorities" footnote-only verses
        // (same class as the Sirach list below, found by the trailing
        // check - invisible to gap analysis)
        'Sir.20.32', 'Sir.23.28',
        // Sirach - "omitted by the best authorities" (footnote-only)
        'Sir.1.5', 'Sir.1.7', 'Sir.1.21',
        'Sir.3.19', 'Sir.3.25',
        'Sir.10.21',
        'Sir.11.15', 'Sir.11.16',
        'Sir.13.14',
        'Sir.16.15', 'Sir.16.16',
        'Sir.17.5', 'Sir.17.9', 'Sir.17.16', 'Sir.17.18', 'Sir.17.21',
        'Sir.18.3',
        'Sir.19.18', 'Sir.19.19', 'Sir.19.21',
        'Sir.20.3',
        'Sir.22.9', 'Sir.22.10',
        'Sir.24.18', 'Sir.24.24',
        'Sir.25.12',
        'Sir.26.19', 'Sir.26.20', 'Sir.26.21', 'Sir.26.22', 'Sir.26.23',
        'Sir.26.24', 'Sir.26.25', 'Sir.26.26', 'Sir.26.27',
        // Prayer of Azariah - omission footnotes / numbering skips
        'PrAzar.1.19', 'PrAzar.1.45', 'PrAzar.1.46', 'PrAzar.1.49',
        // Greek Esther - source numbering skips (9:4 → 9:6 etc.)
        'AddEsth.4.6', 'AddEsth.9.5', 'AddEsth.9.30',
    ]),
};

// ─── Known verse-count variants ───────────────────────────
// Chapters whose source-verified verse count legitimately differs from
// the KJV reference table, keyed by translation ID then 'Book.chapter'.
// These are modern-versification numbering differences with real verse
// text (verified in the source XML 2026-07-18), not omissions:
//   - OEB 3John 15: NA/UBS splits KJV's verse 14 into 14–15
//   - OEB Rev 12:18: "he took his stand on the sea-shore" - KJV folds
//     this into 13:1
//   - WEB Sir 44:23 / PrMan 1:15: Apocrypha numbering variants
//   - WEB Rom 14:24–26: the Romans doxology, placed here instead of
//     16:25–27 (see the WEB entry in KNOWN_VERSE_GAPS)
// The trailing-verse check compares against these counts instead of the
// KJV table where present.
export const KNOWN_VERSE_COUNT_VARIANTS: Record<string, Record<string, number>> = {
    OEB: { '3John.1': 15, 'Rev.12': 18 },
    WEB: { 'Sir.44': 23, 'PrMan.1': 15, 'Rom.14': 26 },
};

// ─── Types ────────────────────────────────────────────────

export type ValidationVerse = {
    book: string;
    chapter: number;
    verse: number;
    verseEnd?: number;
    osisId: string;
    text: string;
};

export type ValidationReport = {
    translation: string;
    verseCount: number;
    bookCount: number;
    /** Hard violations - structurally broken data; the CLI exits non-zero. */
    errors: string[];
    /** Unexpected anomalies worth human review; non-fatal. */
    warnings: string[];
    /** Gaps matching the translation's KNOWN_VERSE_GAPS set - informational. */
    expectedOmissions: string[];
};

// ─── Validation ───────────────────────────────────────────

/**
 * Validate one translation's verse records.
 *
 * Errors (fatal):    zero verse records, duplicate osisIds, unknown book
 *                    IDs, empty text, non-positive chapter/verse numbers,
 *                    inverted bridges, overlapping bridge coverage, more
 *                    chapters than the canon allows.
 * Warnings (review): chapter gaps or short chapter counts (legitimate for
 *                    partial translations like the OEB), verse gaps not in
 *                    the translation's known-omissions set.
 */
export function validateTranslation(
    translation: string,
    verses: ValidationVerse[],
): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const expectedOmissions: string[] = [];

    if (verses.length === 0) {
        errors.push(`${translation}: no verse records - empty or truncated import output`);
    }

    const knownGaps = KNOWN_VERSE_GAPS[translation] ?? new Set<string>();
    const countVariants = KNOWN_VERSE_COUNT_VARIANTS[translation] ?? {};
    const seenIds = new Set<string>();
    // book → chapter → (verse number → osisId that covers it)
    const coverage = new Map<string, Map<number, Map<number, string>>>();

    for (const v of verses) {
        if (seenIds.has(v.osisId)) {
            errors.push(`${translation}: duplicate record ${v.osisId}`);
            continue;
        }
        seenIds.add(v.osisId);

        if (!(v.book in CANONICAL_CHAPTERS)) {
            errors.push(`${translation}: unknown book '${v.book}' (${v.osisId})`);
            continue;
        }
        if (!v.text || v.text.trim() === '') {
            errors.push(`${translation}: empty text at ${v.osisId}`);
        }
        if (!Number.isInteger(v.chapter) || v.chapter < 1) {
            errors.push(`${translation}: invalid chapter number at ${v.osisId}`);
            continue;
        }
        if (!Number.isInteger(v.verse) || v.verse < 1) {
            errors.push(`${translation}: invalid verse number at ${v.osisId}`);
            continue;
        }
        if (v.verseEnd !== undefined && v.verseEnd <= v.verse) {
            errors.push(`${translation}: inverted bridge ${v.osisId} (${v.verse}–${v.verseEnd})`);
            continue;
        }

        let chapters = coverage.get(v.book);
        if (!chapters) { chapters = new Map(); coverage.set(v.book, chapters); }
        let covered = chapters.get(v.chapter);
        if (!covered) { covered = new Map(); chapters.set(v.chapter, covered); }

        const last = v.verseEnd ?? v.verse;
        for (let n = v.verse; n <= last; n++) {
            const prior = covered.get(n);
            if (prior) {
                errors.push(
                    `${translation}: ${v.osisId} overlaps ${prior} at ${v.book}.${v.chapter}.${n}`,
                );
            } else {
                covered.set(n, v.osisId);
            }
        }
    }

    // Structural checks per book
    for (const [book, chapters] of coverage) {
        const canonical = CANONICAL_CHAPTERS[book];
        const maxAllowed = VARIANT_MAX_CHAPTER[book] ?? canonical;
        const maxChapter = Math.max(...chapters.keys());

        if (maxChapter > maxAllowed) {
            errors.push(
                `${translation}: ${book} has chapter ${maxChapter} but the canon has ${maxAllowed}`,
            );
        } else if (
            !SPARSE_CHAPTER_BOOKS.has(book) &&
            (maxChapter < canonical || chapters.size < maxChapter)
        ) {
            // Missing chapters - legitimate for partial translations
            const missing: number[] = [];
            for (let c = 1; c <= canonical; c++) {
                if (!chapters.has(c)) missing.push(c);
            }
            if (missing.length > 0) {
                warnings.push(
                    `${translation}: ${book} missing ${missing.length} chapter(s): ` +
                    summarizeNumbers(missing),
                );
            }
        }

        // Verse gaps within each present chapter
        for (const [chapter, covered] of chapters) {
            const maxVerse = Math.max(...covered.keys());
            for (let n = 1; n <= maxVerse; n++) {
                if (covered.has(n)) continue;
                const ref = `${book}.${chapter}.${n}`;
                if (knownGaps.has(ref)) {
                    expectedOmissions.push(ref);
                } else {
                    warnings.push(`${translation}: verse gap at ${ref}`);
                }
            }

            // Trailing-verse check (known-issues #24): a chapter ending
            // short of the reference count is missing its last verse(s) -
            // invisible to the gap loop above because max-verse shrinks
            // instead of leaving a hole. Chapters absent from the
            // reference table (e.g. WEB-only Apocrypha) are skipped.
            const expected =
                countVariants[`${book}.${chapter}`] ?? KJV_VERSE_COUNTS[book]?.[chapter];
            if (expected === undefined) continue;
            if (maxVerse > expected) {
                warnings.push(
                    `${translation}: ${book}.${chapter} runs to verse ${maxVerse} ` +
                    `but the reference versification has ${expected}`,
                );
            }
            for (let n = maxVerse + 1; n <= expected; n++) {
                const ref = `${book}.${chapter}.${n}`;
                if (knownGaps.has(ref)) {
                    expectedOmissions.push(ref);
                } else {
                    warnings.push(
                        `${translation}: trailing verse gap at ${ref} ` +
                        `(chapter ends at ${maxVerse}, reference versification has ${expected})`,
                    );
                }
            }
        }
    }

    return {
        translation,
        verseCount: verses.length,
        bookCount: coverage.size,
        errors,
        warnings,
        expectedOmissions,
    };
}

/** "1, 2, 3, 7, 8" → "1–3, 7–8" for readable missing-chapter lists. */
function summarizeNumbers(nums: number[]): string {
    const parts: string[] = [];
    let start = nums[0];
    let prev = nums[0];
    for (const n of nums.slice(1).concat(NaN)) {
        if (n === prev + 1) {
            prev = n;
            continue;
        }
        parts.push(start === prev ? `${start}` : `${start}–${prev}`);
        start = prev = n;
    }
    return parts.join(', ');
}
