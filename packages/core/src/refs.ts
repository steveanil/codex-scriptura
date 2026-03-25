import type { BibleReference } from './types.js';
import { findBook, BOOKS } from './books.js';

// ── Lookup aliases ─────────────────────────────────────────
// Maps common human-readable names/abbreviations to canonical OSIS IDs.
// Only includes aliases that differ from the OSIS ID or full name already
// indexed by findBook().

const ALIASES: Record<string, string> = {
    // Common short forms
    'genesis': 'Gen', 'gen': 'Gen', 'ge': 'Gen',
    'exodus': 'Exod', 'exod': 'Exod', 'exo': 'Exod', 'ex': 'Exod',
    'leviticus': 'Lev', 'lev': 'Lev', 'le': 'Lev',
    'numbers': 'Num', 'num': 'Num', 'nu': 'Num',
    'deuteronomy': 'Deut', 'deut': 'Deut', 'dt': 'Deut',
    'joshua': 'Josh', 'josh': 'Josh', 'jos': 'Josh',
    'judges': 'Judg', 'judg': 'Judg', 'jdg': 'Judg',
    'ruth': 'Ruth', 'ru': 'Ruth',
    '1 samuel': '1Sam', '1samuel': '1Sam', '1sam': '1Sam', '1 sam': '1Sam', '1sa': '1Sam',
    '2 samuel': '2Sam', '2samuel': '2Sam', '2sam': '2Sam', '2 sam': '2Sam', '2sa': '2Sam',
    '1 kings': '1Kgs', '1kings': '1Kgs', '1kgs': '1Kgs', '1ki': '1Kgs', '1 ki': '1Kgs',
    '2 kings': '2Kgs', '2kings': '2Kgs', '2kgs': '2Kgs', '2ki': '2Kgs', '2 ki': '2Kgs',
    '1 chronicles': '1Chr', '1chronicles': '1Chr', '1chr': '1Chr', '1ch': '1Chr', '1 ch': '1Chr',
    '2 chronicles': '2Chr', '2chronicles': '2Chr', '2chr': '2Chr', '2ch': '2Chr', '2 ch': '2Chr',
    'ezra': 'Ezra', 'ezr': 'Ezra',
    'nehemiah': 'Neh', 'neh': 'Neh', 'ne': 'Neh',
    'esther': 'Esth', 'esth': 'Esth', 'est': 'Esth',
    'job': 'Job', 'jb': 'Job',
    'psalms': 'Ps', 'psalm': 'Ps', 'ps': 'Ps', 'psa': 'Ps',
    'proverbs': 'Prov', 'prov': 'Prov', 'pr': 'Prov', 'pro': 'Prov',
    'ecclesiastes': 'Eccl', 'eccl': 'Eccl', 'ecc': 'Eccl', 'ec': 'Eccl',
    'song of solomon': 'Song', 'song': 'Song', 'sos': 'Song', 'ss': 'Song',
    'isaiah': 'Isa', 'isa': 'Isa', 'is': 'Isa',
    'jeremiah': 'Jer', 'jer': 'Jer', 'je': 'Jer',
    'lamentations': 'Lam', 'lam': 'Lam', 'la': 'Lam',
    'ezekiel': 'Ezek', 'ezek': 'Ezek', 'eze': 'Ezek',
    'daniel': 'Dan', 'dan': 'Dan', 'da': 'Dan',
    'hosea': 'Hos', 'hos': 'Hos', 'ho': 'Hos',
    'joel': 'Joel', 'joe': 'Joel',
    'amos': 'Amos', 'am': 'Amos',
    'obadiah': 'Obad', 'obad': 'Obad', 'ob': 'Obad',
    'jonah': 'Jonah', 'jon': 'Jonah',
    'micah': 'Mic', 'mic': 'Mic',
    'nahum': 'Nah', 'nah': 'Nah', 'na': 'Nah',
    'habakkuk': 'Hab', 'hab': 'Hab',
    'zephaniah': 'Zeph', 'zeph': 'Zeph', 'zep': 'Zeph',
    'haggai': 'Hag', 'hag': 'Hag',
    'zechariah': 'Zech', 'zech': 'Zech', 'zec': 'Zech',
    'malachi': 'Mal', 'mal': 'Mal',

    // New Testament
    'matthew': 'Matt', 'matt': 'Matt', 'mat': 'Matt', 'mt': 'Matt',
    'mark': 'Mark', 'mk': 'Mark', 'mr': 'Mark',
    'luke': 'Luke', 'lk': 'Luke', 'lu': 'Luke',
    'john': 'John', 'joh': 'John', 'jn': 'John',
    'acts': 'Acts', 'act': 'Acts', 'ac': 'Acts',
    'romans': 'Rom', 'rom': 'Rom', 'ro': 'Rom',
    '1 corinthians': '1Cor', '1corinthians': '1Cor', '1cor': '1Cor', '1co': '1Cor', '1 cor': '1Cor',
    '2 corinthians': '2Cor', '2corinthians': '2Cor', '2cor': '2Cor', '2co': '2Cor', '2 cor': '2Cor',
    'galatians': 'Gal', 'gal': 'Gal', 'ga': 'Gal',
    'ephesians': 'Eph', 'eph': 'Eph',
    'philippians': 'Phil', 'phil': 'Phil', 'php': 'Phil',
    'colossians': 'Col', 'col': 'Col',
    '1 thessalonians': '1Thess', '1thessalonians': '1Thess', '1thess': '1Thess', '1th': '1Thess', '1 thess': '1Thess',
    '2 thessalonians': '2Thess', '2thessalonians': '2Thess', '2thess': '2Thess', '2th': '2Thess', '2 thess': '2Thess',
    '1 timothy': '1Tim', '1timothy': '1Tim', '1tim': '1Tim', '1ti': '1Tim', '1 tim': '1Tim',
    '2 timothy': '2Tim', '2timothy': '2Tim', '2tim': '2Tim', '2ti': '2Tim', '2 tim': '2Tim',
    'titus': 'Titus', 'tit': 'Titus',
    'philemon': 'Phlm', 'phlm': 'Phlm', 'phm': 'Phlm',
    'hebrews': 'Heb', 'heb': 'Heb',
    'james': 'Jas', 'jas': 'Jas', 'jm': 'Jas',
    '1 peter': '1Pet', '1peter': '1Pet', '1pet': '1Pet', '1pe': '1Pet', '1 pet': '1Pet',
    '2 peter': '2Pet', '2peter': '2Pet', '2pet': '2Pet', '2pe': '2Pet', '2 pet': '2Pet',
    '1 john': '1John', '1john': '1John', '1jn': '1John', '1 jn': '1John',
    '2 john': '2John', '2john': '2John', '2jn': '2John', '2 jn': '2John',
    '3 john': '3John', '3john': '3John', '3jn': '3John', '3 jn': '3John',
    'jude': 'Jude', 'jud': 'Jude',
    'revelation': 'Rev', 'rev': 'Rev', 're': 'Rev', 'apocalypse': 'Rev',
};

/**
 * Resolve a human-readable book name to its OSIS ID.
 *
 * Handles: "Genesis", "Gen", "gen", "ge", "1 Cor", "1cor", "Revelation", etc.
 */
export function resolveBook(input: string): string | undefined {
    const trimmed = input.trim();

    // Try direct OSIS / name / abbrev lookup first
    const direct = findBook(trimmed);
    if (direct) return direct.osisId;

    // Try alias table
    const alias = ALIASES[trimmed.toLowerCase()];
    if (alias) return alias;

    return undefined;
}

/**
 * Parse a Bible reference string into structured data.
 *
 * Supported formats:
 *   "John 3:16"           → { book: "John", chapter: 3, verse: 16 }
 *   "Gen 1:1-3"           → { book: "Gen", chapter: 1, verse: 1, verseEnd: 3 }
 *   "Gen 1"               → { book: "Gen", chapter: 1 }
 *   "1 Cor 13:4-7"        → { book: "1Cor", chapter: 13, verse: 4, verseEnd: 7 }
 *   "Ps 119"              → { book: "Ps", chapter: 119 }
 *   "Genesis 1:1"         → { book: "Gen", chapter: 1, verse: 1 }
 *   "Gen.1.1"             → { book: "Gen", chapter: 1, verse: 1 }  (OSIS format)
 */
export function parseReference(input: string): BibleReference | undefined {
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    // Try OSIS format first: "Gen.1.1" or "Gen.1"
    const osisMatch = trimmed.match(/^(\d?\s?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/);
    if (osisMatch) {
        const bookId = resolveBook(osisMatch[1]);
        if (bookId) {
            return {
                book: bookId,
                chapter: parseInt(osisMatch[2], 10),
                verse: osisMatch[3] ? parseInt(osisMatch[3], 10) : undefined,
            };
        }
    }

    // Human format: "Book chapter:verse-verseEnd" or "Book chapter"
    // The book name can include digits and spaces (e.g. "1 Corinthians", "2 Sam")
    const humanMatch = trimmed.match(
        /^(\d?\s?[A-Za-z][A-Za-z\s]*?)\s+(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?$/
    );
    if (humanMatch) {
        const bookId = resolveBook(humanMatch[1]);
        if (bookId) {
            return {
                book: bookId,
                chapter: parseInt(humanMatch[2], 10),
                verse: humanMatch[3] ? parseInt(humanMatch[3], 10) : undefined,
                verseEnd: humanMatch[4] ? parseInt(humanMatch[4], 10) : undefined,
            };
        }
    }

    return undefined;
}

/**
 * Format a BibleReference into a human-readable string.
 *   { book: "Gen", chapter: 1, verse: 1 } → "Genesis 1:1"
 */
export function formatReference(ref: BibleReference): string {
    const book = findBook(ref.book);
    const name = book?.name ?? ref.book;

    let result = `${name} ${ref.chapter}`;
    if (ref.verse !== undefined) {
        result += `:${ref.verse}`;
        if (ref.verseEnd !== undefined && ref.verseEnd !== ref.verse) {
            result += `-${ref.verseEnd}`;
        }
    }
    return result;
}

/**
 * Convert a BibleReference to an OSIS ID string.
 *   { book: "Gen", chapter: 1, verse: 1 } → "Gen.1.1"
 */
export function toOsisId(ref: BibleReference): string {
    let result = `${ref.book}.${ref.chapter}`;
    if (ref.verse !== undefined) {
        result += `.${ref.verse}`;
    }
    return result;
}
