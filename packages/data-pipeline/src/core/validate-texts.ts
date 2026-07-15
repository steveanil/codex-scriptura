/**
 * Versification validation for imported translation texts.
 *
 * Catches the class of pipeline bug that silently corrupts scripture data:
 * dropped verses (the verse-bridge regex bug), duplicated records, note
 * content masquerading as verses, and structural drift between imports.
 *
 * Pure logic — the CLI wrapper lives in src/validate-texts.ts.
 */

// ─── Canonical chapter counts ─────────────────────────────
// Mirrored from @codex-scriptura/core BOOKS (this package re-declares
// rather than imports core — see core/types.ts). Keep in sync when the
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
// Verse numbers legitimately absent from our source texts. Two causes,
// both verified against the source XML during the 2026-07 review:
//   1. Text-critical omissions — translations following modern critical
//      texts (NA/UBS; "the best authorities" for Sirach) omit verses the
//      KJV/TR numbering includes. In the sources these positions carry
//      only an omission footnote, which the importers correctly drop.
//   2. Source versification skips — the source's own numbering jumps
//      (e.g. WEB Greek Esther 9:4 → 9:6; KJV Greek Esther starts at 10:4).
// Gaps at these refs are reported as expected omissions, not warnings.
//
// LIMITATION: omissions of a chapter's *last* verse(s) (e.g. WEB Sir 20:32,
// Rom 16:25–27) are undetectable by gap analysis — max-verse shrinks
// instead of leaving a hole. Detecting those requires a per-chapter
// canonical verse-count table (future enhancement, tracked in
// docs/known-issues.md #3 follow-up).
export const KNOWN_VERSE_GAPS = new Set<string>([
    // NT critical-text omissions (verified in WEB and OEB sources)
    'Matt.17.21', 'Matt.18.11', 'Matt.23.14',
    'Mark.7.16', 'Mark.9.44', 'Mark.9.46', 'Mark.11.26', 'Mark.15.28',
    'Luke.17.36', 'Luke.22.20', 'Luke.23.17', 'Luke.24.12', 'Luke.24.40',
    'John.5.4',
    'Acts.8.37', 'Acts.15.34', 'Acts.24.7', 'Acts.28.29',
    'Rom.16.24',
    // WEB Sirach — "omitted by the best authorities" (footnote-only)
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
    // WEB Prayer of Azariah — omission footnotes / numbering skips
    'PrAzar.1.19', 'PrAzar.1.45', 'PrAzar.1.46', 'PrAzar.1.49',
    // WEB Greek Esther — source numbering skips (9:4 → 9:6 etc.)
    'AddEsth.4.6', 'AddEsth.9.5', 'AddEsth.9.30',
    // KJV Greek Esther — additions begin at 10:4 by design
    'EsthGr.10.1', 'EsthGr.10.2', 'EsthGr.10.3',
]);

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
    /** Hard violations — structurally broken data; the CLI exits non-zero. */
    errors: string[];
    /** Unexpected anomalies worth human review; non-fatal. */
    warnings: string[];
    /** Gaps matching KNOWN_TEXT_CRITICAL_OMISSIONS — informational. */
    expectedOmissions: string[];
};

// ─── Validation ───────────────────────────────────────────

/**
 * Validate one translation's verse records.
 *
 * Errors (fatal):    duplicate osisIds, unknown book IDs, empty text,
 *                    non-positive/inverted verse numbers, overlapping
 *                    bridge coverage, more chapters than the canon allows.
 * Warnings (review): chapter gaps or short chapter counts (legitimate for
 *                    partial translations like the OEB), verse gaps not in
 *                    the known-omissions list.
 */
export function validateTranslation(
    translation: string,
    verses: ValidationVerse[],
): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const expectedOmissions: string[] = [];

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
            // Missing chapters — legitimate for partial translations
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
                if (KNOWN_VERSE_GAPS.has(ref)) {
                    expectedOmissions.push(ref);
                } else {
                    warnings.push(`${translation}: verse gap at ${ref}`);
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
