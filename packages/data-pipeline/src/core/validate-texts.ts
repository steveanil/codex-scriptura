/**
 * Structural validation for imported translation texts (issue #321).
 *
 * Catches the classes of pipeline bug that silently corrupted scripture
 * data before: dropped or duplicated verses, footnote text or markup
 * leaking into verse text, punctuation detached by tag stripping (#175),
 * Psalm superscriptions leaking into verse 1 (#176), container-markup
 * verses skipped (#177), and books the client cannot reach (#177). Every
 * finding is tagged with the invariant that produced it so the report in
 * _metadata/text-validation.json lists each invariant with a count.
 *
 * Structural and importer correctness only: whether a reading is right is
 * the golden anchors' job (golden-texts.test.ts).
 *
 * Pure logic - the CLI wrapper lives in src/validate-texts.ts.
 */

import { BOOKS, OT_BOOKS, NT_BOOKS } from '@codex-scriptura/core';
import { KJV_VERSE_COUNTS } from './kjv-versification.js';

// ─── Canonical chapter counts ─────────────────────────────
// Derived from core BOOKS so an importer can never emit a book id the
// client does not know (#177 stranded AddEsth/4Macc). EpJer and AddPs are
// single-chapter books numbered 6 and 151 by sources; VARIANT_MAX_CHAPTER
// below allows that.
export const CANONICAL_CHAPTERS: Record<string, number> = Object.fromEntries(
    BOOKS.map((b) => [b.osisId, b.chapters]),
);

// ─── Expected books ───────────────────────────────────────
// What each pinned source is known to contain, verified against the
// imported corpus 2026-09-17. A book absent from the output leaves no
// record for the per-book checks to see, so a whole book can vanish
// (an importer skipping a USFM code, a source dropping a section)
// without any other invariant firing. These are validation baselines like
// KNOWN_VERSE_GAPS: a new translation gets its own verified list, and a
// source that legitimately adds or drops a book gets its list updated
// deliberately.
const PROTESTANT_66 = [...OT_BOOKS, ...NT_BOOKS].map((b) => b.osisId);

export const EXPECTED_BOOKS: Record<string, ReadonlySet<string>> = {
    // CrossWire KJVA: the 1611 Apocrypha, 14 books, no 3/4 Maccabees
    KJV: new Set([
        ...PROTESTANT_66,
        'Tob', 'Jdt', 'AddEsth', 'Wis', 'Sir', 'Bar', 'PrAzar', 'Sus', 'Bel',
        '1Macc', '2Macc', '1Esd', '2Esd', 'PrMan',
    ]),
    // eBible WEB with Deuterocanon: 17 books incl. EpJer split from Baruch,
    // Psalm 151 and 3/4 Maccabees; no 2 Esdras
    WEB: new Set([
        ...PROTESTANT_66,
        'Tob', 'Jdt', 'AddEsth', 'Wis', 'Sir', 'Bar', 'EpJer', 'PrAzar', 'Sus', 'Bel',
        '1Macc', '2Macc', '1Esd', 'PrMan', 'AddPs', '3Macc', '4Macc',
    ]),
    // OEB is a work in progress: full NT, Ruth, Esther, Psalms and the Twelve
    OEB: new Set([
        'Ruth', 'Esth', 'Ps', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
        ...NT_BOOKS.map((b) => b.osisId),
    ]),
    ASV: new Set(PROTESTANT_66),
    BSB: new Set(PROTESTANT_66),
    DBY: new Set(PROTESTANT_66),
    YLT: new Set(PROTESTANT_66),
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
// Esther (AddEsth) spans sparse chapter ranges (KJV has 10-16 starting at
// 10:4; WEB has 1-10); Baruch lacks chapter 6 because it is split out as
// EpJer. Missing-chapter warnings are suppressed for these.
export const SPARSE_CHAPTER_BOOKS = new Set<string>([
    'EpJer', 'AddPs', 'AddEsth', 'Bar',
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
        // Greek Esther - additions begin at 10:4 by design (10:1-3 are
        // "…" placeholders in the source, dropped at import)
        'AddEsth.10.1', 'AddEsth.10.2', 'AddEsth.10.3',
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
    // AddEsth.10: WEB's Greek Esther follows the canonical 3-verse chapter
    // 10 (additions bracketed in place); the KJV reference runs to 10:13
    // because it numbers addition F inside chapter 10.
    WEB: { 'Sir.44': 23, 'PrMan.1': 15, 'Rom.14': 26, 'AddEsth.10': 3 },
};

// ─── Types ────────────────────────────────────────────────

export type ValidationVerse = {
    book: string;
    chapter: number;
    verse: number;
    verseEnd?: number;
    osisId: string;
    text: string;
    /** Space-separated Strong's tokens, when the source is tagged. */
    lemmas?: string;
    /** JSON-encoded [start, end, strongs] spans, when word-aligned. */
    align?: string;
};

export type InvariantId =
    | 'empty-dataset'
    | 'duplicate-id'
    | 'unknown-book'
    | 'empty-text'
    | 'invalid-number'
    | 'inverted-bridge'
    | 'bridge-overlap'
    | 'bridge-range'
    | 'chapter-beyond-canon'
    | 'missing-book'
    | 'missing-chapters'
    | 'verse-gap'
    | 'trailing-gap'
    | 'verse-overrun'
    | 'markup-residue'
    | 'detached-punctuation'
    | 'psalm-title-text'
    | 'psalm-title-lemmas'
    | 'lemma-format'
    | 'alignment';

export type InvariantCount = { id: InvariantId; severity: 'error' | 'warning'; count: number };

export type ValidationReport = {
    translation: string;
    verseCount: number;
    bookCount: number;
    /** Verse records per book - the shape the manifest and #244 sanity checks compare against. */
    books: Record<string, number>;
    /** Every invariant that fired, with how many findings it produced. */
    checks: InvariantCount[];
    /** Hard violations - structurally broken data; the CLI exits non-zero. */
    errors: string[];
    /** Unexpected anomalies worth human review; non-fatal. */
    warnings: string[];
    /** Gaps matching the translation's KNOWN_VERSE_GAPS set - informational. */
    expectedOmissions: string[];
};

// ─── Text-shape invariants ────────────────────────────────

/** Residual XML/USFM markup: a tag, an entity, or a backslash marker in verse text. */
const MARKUP_RESIDUE = /<[a-zA-Z/]|&[a-zA-Z#][a-zA-Z0-9]*;|\\[a-z]/;

/**
 * A word followed by a space and closing punctuation (#175: "said she ,
 * God"). Anchoring on a letter or digit before the space rules out the
 * shapes English scripture legitimately prints: punctuation before an
 * ellipsis ("say, ...and", DBY), a dash ("rest — !", YLT) or a closing
 * quote ("‘Your son is living’ ;", OEB). A lone period must not be the
 * start of an ellipsis. The capture is the occurrence key used by the
 * allowlist: the word, the space and the mark ("treasures ?").
 */
const DETACHED_PUNCTUATION = /([\p{L}\p{N}]+\s(?:[,;:!?]|\.(?!\.)))/gu;

/**
 * Source-inherent detached punctuation, verified in the upstream XML
 * 2026-09-17 (CrossWire KJV Apocrypha typos). Keyed by ref, listing each
 * known occurrence exactly, so the exemption covers that typo and nothing
 * else: a second detached mark in the same verse is still a hard error.
 */
export const KNOWN_DETACHED_PUNCTUATION: Record<string, Record<string, readonly string[]>> = {
    KJV: {
        'Bar.3.15': ['treasures ?'],
        'PrAzar.1.35': ['Lord :'],
        'PrAzar.1.36': ['Lord :'],
        'Bel.1.27': ['sunder :'],
    },
};

/** Occurrences of detached punctuation in `text` not covered by the known list, one entry per surplus match. */
export function unexpectedDetachedPunctuation(text: string, known: readonly string[] = []): string[] {
    const budget = new Map<string, number>();
    for (const k of known) budget.set(k, (budget.get(k) ?? 0) + 1);
    const unexpected: string[] = [];
    for (const m of text.matchAll(DETACHED_PUNCTUATION)) {
        const key = m[1];
        const left = budget.get(key) ?? 0;
        if (left > 0) budget.set(key, left - 1);
        else unexpected.push(key);
    }
    return unexpected;
}

/** Psalm superscription openers that must not begin verse 1 (English bibles keep titles outside the verse). */
const PSALM_TITLE_TEXT = /^(?:To the [Cc]hief Musician|For the [Cc]hief Musician|For the (?:choir|choirmaster|director|music leader)|A Psalm|A Song|A Prayer|Maschil|Michtam|Miktam|Shiggaion|An Instruction)\b/;

/** Translations whose source numbers the superscription as part of verse 1 by design. */
export const TITLE_IN_VERSE_ONE = new Set<string>(['YLT']);

/**
 * Strong's numbers that occur only in Psalm superscriptions: mizmor
 * (psalm), natsach (chief musician), michtam, maskil, shiggaion. Verified
 * 2026-09-17: zero occurrences in any Psalm body verse across all tagged
 * translations, so their presence in verse 1 is a title leak (#176).
 */
export const SUPERSCRIPTION_LEMMAS = new Set<string>(['H4210', 'H5329', 'H4387', 'H4905', 'H7692']);

/**
 * Verse-1 records whose source tags carry superscription numbers on body
 * words (eBible's ASV/BSB `s=` attributes assign the title's mizmor or
 * lamnatseach to "of"/"upon" in verse 1). Upstream tagging, not an
 * importer bug; verified against the USFX 2026-09-17. Keyed by ref with
 * the exact tokens observed, so a different title token in a listed Psalm
 * is still a hard error, as is any token in an unlisted Psalm.
 */
export const KNOWN_TITLE_LEMMA_LEAKS: Record<string, Record<string, ReadonlySet<string>>> = {
    ASV: {
        'Ps.4.1': new Set(['H4210', 'H5329']),
        'Ps.12.1': new Set(['H4210']),
        'Ps.19.1': new Set(['H4210']),
        'Ps.20.1': new Set(['H4210', 'H5329']),
        'Ps.22.1': new Set(['H4210']),
        'Ps.41.1': new Set(['H4210']),
        'Ps.51.1': new Set(['H4210', 'H5329']),
        'Ps.52.1': new Set(['H4905']),
        'Ps.58.1': new Set(['H4387']),
        'Ps.59.1': new Set(['H5329']),
        'Ps.64.1': new Set(['H4210']),
        'Ps.67.1': new Set(['H5329']),
        'Ps.75.1': new Set(['H4210']),
        'Ps.80.1': new Set(['H4210', 'H5329']),
        'Ps.82.1': new Set(['H4210']),
        'Ps.89.1': new Set(['H4905']),
        'Ps.109.1': new Set(['H4210']),
    },
    BSB: {
        'Ps.4.1': new Set(['H4210']),
        'Ps.19.1': new Set(['H4210']),
        'Ps.20.1': new Set(['H4210']),
        'Ps.22.1': new Set(['H4210']),
        'Ps.41.1': new Set(['H4210']),
        'Ps.45.1': new Set(['H4905']),
        'Ps.51.1': new Set(['H5329']),
        'Ps.52.1': new Set(['H4905']),
        'Ps.57.1': new Set(['H5329']),
        'Ps.58.1': new Set(['H4387']),
        'Ps.64.1': new Set(['H4210']),
        'Ps.67.1': new Set(['H5329']),
        'Ps.75.1': new Set(['H5329']),
        'Ps.80.1': new Set(['H4210', 'H5329']),
        'Ps.89.1': new Set(['H4905']),
        'Ps.109.1': new Set(['H4210']),
        'Ps.140.1': new Set(['H4210']),
    },
};

const NO_TOKENS: ReadonlySet<string> = new Set();

/** Normalized Strong's token: H or G, no zero padding, at most five digits. */
const LEMMA_TOKEN = /^[HG][1-9]\d{0,4}$/;

/**
 * Word-alignment invariants: spans parse, lie inside the text, are ordered
 * and non-overlapping, slice to a trimmed non-empty surface, and carry
 * only tokens present in the verse's lemma bag. Spans are sparse by
 * design (untagged and translator-supplied words have none), so there is
 * no "reconstruct the verse from its spans" check; the importers' mirror
 * walk already guarantees offsets were derived against the final text and
 * drops alignment wherever the two chains disagree.
 */
export function alignmentProblems(v: ValidationVerse): string[] {
    if (!v.align) return [];
    let spans: unknown;
    try {
        spans = JSON.parse(v.align);
    } catch {
        return [`${v.osisId}: align is not valid JSON`];
    }
    if (!Array.isArray(spans)) return [`${v.osisId}: align is not an array`];
    const problems: string[] = [];
    const lemmaBag = new Set((v.lemmas ?? '').split(' ').filter(Boolean));
    let prevEnd = 0;
    for (const span of spans) {
        if (!Array.isArray(span) || span.length !== 3 || typeof span[0] !== 'number' || typeof span[1] !== 'number' || typeof span[2] !== 'string') {
            problems.push(`${v.osisId}: malformed span ${JSON.stringify(span)}`);
            continue;
        }
        const [start, end, ids] = span as [number, number, string];
        if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= v.text.length)) {
            problems.push(`${v.osisId}: span ${start}-${end} outside text of length ${v.text.length}`);
            continue;
        }
        if (start < prevEnd) problems.push(`${v.osisId}: span ${start}-${end} overlaps or precedes the previous span`);
        prevEnd = end;
        const surface = v.text.slice(start, end);
        if (surface.trim() !== surface) problems.push(`${v.osisId}: span ${start}-${end} has edge whitespace in "${surface}"`);
        for (const id of ids.split(' ')) {
            if (!lemmaBag.has(id)) problems.push(`${v.osisId}: aligned ${id} is not in the verse's lemmas`);
        }
    }
    return problems;
}

// ─── Validation ───────────────────────────────────────────

/**
 * Validate one translation's verse records.
 *
 * Errors (fatal):    zero verse records, duplicate osisIds, book IDs core
 *                    BOOKS does not know, empty text, non-positive
 *                    chapter/verse numbers, inverted or out-of-range
 *                    bridges, overlapping bridge coverage, more chapters
 *                    than the canon allows, verse gaps and trailing gaps not
 *                    in the translation's known-omissions set, markup
 *                    residue, detached punctuation, Psalm superscription
 *                    text or lemmas in verse 1, malformed lemma tokens,
 *                    malformed alignment spans.
 * Warnings (review): missing chapters (legitimate for partial translations
 *                    like the OEB) and chapters running past the reference
 *                    count (legitimate versification variants).
 */
export function validateTranslation(
    translation: string,
    verses: ValidationVerse[],
): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const expectedOmissions: string[] = [];
    const counts = new Map<InvariantId, InvariantCount>();
    const tally = (id: InvariantId, severity: 'error' | 'warning') => {
        const c = counts.get(id) ?? { id, severity, count: 0 };
        c.count++;
        counts.set(id, c);
    };
    const fail = (id: InvariantId, message: string) => { errors.push(`${translation}: ${message}`); tally(id, 'error'); };
    const warn = (id: InvariantId, message: string) => { warnings.push(`${translation}: ${message}`); tally(id, 'warning'); };

    if (verses.length === 0) {
        fail('empty-dataset', 'no verse records - empty or truncated import output');
    }

    const knownGaps = KNOWN_VERSE_GAPS[translation] ?? new Set<string>();
    const countVariants = KNOWN_VERSE_COUNT_VARIANTS[translation] ?? {};
    const knownDetached = KNOWN_DETACHED_PUNCTUATION[translation] ?? {};
    const knownTitleLeaks = KNOWN_TITLE_LEMMA_LEAKS[translation] ?? {};
    const expectedBooks = EXPECTED_BOOKS[translation];
    const seenIds = new Set<string>();
    const books: Record<string, number> = {};
    // book → chapter → (verse number → osisId that covers it)
    const coverage = new Map<string, Map<number, Map<number, string>>>();

    for (const v of verses) {
        if (seenIds.has(v.osisId)) {
            fail('duplicate-id', `duplicate record ${v.osisId}`);
            continue;
        }
        seenIds.add(v.osisId);

        if (!(v.book in CANONICAL_CHAPTERS)) {
            fail('unknown-book', `unknown book '${v.book}' (${v.osisId}) - not in core BOOKS, the client could not reach it`);
            continue;
        }
        books[v.book] = (books[v.book] ?? 0) + 1;

        if (!v.text || v.text.trim() === '') {
            fail('empty-text', `empty text at ${v.osisId}`);
        } else {
            if (MARKUP_RESIDUE.test(v.text)) {
                fail('markup-residue', `markup or note residue in ${v.osisId}: "${excerpt(v.text, MARKUP_RESIDUE)}"`);
            }
            for (const occurrence of unexpectedDetachedPunctuation(v.text, knownDetached[v.osisId])) {
                fail('detached-punctuation', `detached punctuation in ${v.osisId}: "${occurrence}"`);
            }
            if (v.book === 'Ps' && v.verse === 1 && !TITLE_IN_VERSE_ONE.has(translation) && PSALM_TITLE_TEXT.test(v.text)) {
                fail('psalm-title-text', `superscription text in ${v.osisId}: "${v.text.slice(0, 40)}"`);
            }
        }

        if (v.lemmas !== undefined) {
            const tokens = v.lemmas.split(' ');
            const bad = tokens.filter((t) => !LEMMA_TOKEN.test(t));
            if (bad.length > 0) fail('lemma-format', `malformed lemma token(s) in ${v.osisId}: ${bad.slice(0, 3).join(' ')}`);
            if (v.book === 'Ps' && v.verse === 1) {
                const permitted = knownTitleLeaks[v.osisId] ?? NO_TOKENS;
                const leaked = tokens.filter((t) => SUPERSCRIPTION_LEMMAS.has(t) && !permitted.has(t));
                if (leaked.length > 0) fail('psalm-title-lemmas', `superscription lemma(s) in ${v.osisId}: ${leaked.join(' ')}`);
            }
        }
        for (const problem of alignmentProblems(v)) fail('alignment', problem);

        if (!Number.isInteger(v.chapter) || v.chapter < 1) {
            fail('invalid-number', `invalid chapter number at ${v.osisId}`);
            continue;
        }
        if (!Number.isInteger(v.verse) || v.verse < 1) {
            fail('invalid-number', `invalid verse number at ${v.osisId}`);
            continue;
        }
        if (v.verseEnd !== undefined && v.verseEnd <= v.verse) {
            fail('inverted-bridge', `inverted bridge ${v.osisId} (${v.verse}–${v.verseEnd})`);
            continue;
        }
        if (v.verseEnd !== undefined) {
            const expected = countVariants[`${v.book}.${v.chapter}`] ?? KJV_VERSE_COUNTS[v.book]?.[v.chapter];
            if (expected !== undefined && v.verseEnd > expected) {
                fail('bridge-range', `bridge ${v.osisId} runs to verse ${v.verseEnd} but the reference versification has ${expected}`);
            }
        }

        let chapters = coverage.get(v.book);
        if (!chapters) { chapters = new Map(); coverage.set(v.book, chapters); }
        let covered = chapters.get(v.chapter);
        if (!covered) { covered = new Map(); chapters.set(v.chapter, covered); }

        const last = v.verseEnd ?? v.verse;
        for (let n = v.verse; n <= last; n++) {
            const prior = covered.get(n);
            if (prior) {
                fail('bridge-overlap', `${v.osisId} overlaps ${prior} at ${v.book}.${v.chapter}.${n}`);
            } else {
                covered.set(n, v.osisId);
            }
        }
    }

    // A book that vanished leaves nothing for the per-book checks to see
    if (expectedBooks) {
        for (const book of expectedBooks) {
            if (!coverage.has(book)) fail('missing-book', `expected book ${book} is absent from the output`);
        }
    }

    // Structural checks per book
    for (const [book, chapters] of coverage) {
        const canonical = CANONICAL_CHAPTERS[book];
        const maxAllowed = VARIANT_MAX_CHAPTER[book] ?? canonical;
        const maxChapter = Math.max(...chapters.keys());

        if (maxChapter > maxAllowed) {
            fail('chapter-beyond-canon', `${book} has chapter ${maxChapter} but the canon has ${maxAllowed}`);
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
                warn('missing-chapters', `${book} missing ${missing.length} chapter(s): ${summarizeNumbers(missing)}`);
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
                    // A hole in the numbering is a dropped verse (#177
                    // class) until its omission is source-verified and
                    // listed in KNOWN_VERSE_GAPS.
                    fail('verse-gap', `verse gap at ${ref}`);
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
                warn('verse-overrun', `${book}.${chapter} runs to verse ${maxVerse} but the reference versification has ${expected}`);
            }
            for (let n = maxVerse + 1; n <= expected; n++) {
                const ref = `${book}.${chapter}.${n}`;
                if (knownGaps.has(ref)) {
                    expectedOmissions.push(ref);
                } else {
                    fail('trailing-gap', `trailing verse gap at ${ref} (chapter ends at ${maxVerse}, reference versification has ${expected})`);
                }
            }
        }
    }

    return {
        translation,
        verseCount: verses.length,
        bookCount: coverage.size,
        books,
        checks: [...counts.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
        errors,
        warnings,
        expectedOmissions,
    };
}

/** A short window of text around the first match, for readable findings. */
function excerpt(text: string, re: RegExp): string {
    const m = re.exec(text);
    if (!m) return text.slice(0, 40);
    const start = Math.max(0, m.index - 20);
    return (start > 0 ? '…' : '') + text.slice(start, m.index + m[0].length + 15);
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
