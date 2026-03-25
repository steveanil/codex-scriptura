import type { BookMeta, Testament } from './types.js';

// Complete canonical book list with OSIS IDs, display names, abbreviations,
// testament assignment, and chapter counts.

function b(osisId: string, name: string, abbrev: string, testament: Testament, chapters: number): BookMeta {
    return { osisId, name, abbrev, testament, chapters };
}

export const BOOKS: readonly BookMeta[] = [
    // ── Old Testament ──────────────────────────────
    b('Gen', 'Genesis', 'Gen', 'OT', 50),
    b('Exod', 'Exodus', 'Exod', 'OT', 40),
    b('Lev', 'Leviticus', 'Lev', 'OT', 27),
    b('Num', 'Numbers', 'Num', 'OT', 36),
    b('Deut', 'Deuteronomy', 'Deut', 'OT', 34),
    b('Josh', 'Joshua', 'Josh', 'OT', 24),
    b('Judg', 'Judges', 'Judg', 'OT', 21),
    b('Ruth', 'Ruth', 'Ruth', 'OT', 4),
    b('1Sam', '1 Samuel', '1Sam', 'OT', 31),
    b('2Sam', '2 Samuel', '2Sam', 'OT', 24),
    b('1Kgs', '1 Kings', '1Kgs', 'OT', 22),
    b('2Kgs', '2 Kings', '2Kgs', 'OT', 25),
    b('1Chr', '1 Chronicles', '1Chr', 'OT', 29),
    b('2Chr', '2 Chronicles', '2Chr', 'OT', 36),
    b('Ezra', 'Ezra', 'Ezra', 'OT', 10),
    b('Neh', 'Nehemiah', 'Neh', 'OT', 13),
    b('Esth', 'Esther', 'Esth', 'OT', 10),
    b('Job', 'Job', 'Job', 'OT', 42),
    b('Ps', 'Psalms', 'Ps', 'OT', 150),
    b('Prov', 'Proverbs', 'Prov', 'OT', 31),
    b('Eccl', 'Ecclesiastes', 'Eccl', 'OT', 12),
    b('Song', 'Song of Solomon', 'Song', 'OT', 8),
    b('Isa', 'Isaiah', 'Isa', 'OT', 66),
    b('Jer', 'Jeremiah', 'Jer', 'OT', 52),
    b('Lam', 'Lamentations', 'Lam', 'OT', 5),
    b('Ezek', 'Ezekiel', 'Ezek', 'OT', 48),
    b('Dan', 'Daniel', 'Dan', 'OT', 12),
    b('Hos', 'Hosea', 'Hos', 'OT', 14),
    b('Joel', 'Joel', 'Joel', 'OT', 3),
    b('Amos', 'Amos', 'Amos', 'OT', 9),
    b('Obad', 'Obadiah', 'Obad', 'OT', 1),
    b('Jonah', 'Jonah', 'Jonah', 'OT', 4),
    b('Mic', 'Micah', 'Mic', 'OT', 7),
    b('Nah', 'Nahum', 'Nah', 'OT', 3),
    b('Hab', 'Habakkuk', 'Hab', 'OT', 3),
    b('Zeph', 'Zephaniah', 'Zeph', 'OT', 3),
    b('Hag', 'Haggai', 'Hag', 'OT', 2),
    b('Zech', 'Zechariah', 'Zech', 'OT', 14),
    b('Mal', 'Malachi', 'Mal', 'OT', 4),

    // ── Apocrypha / Deuterocanon ───────────────────
    b('Tob', 'Tobit', 'Tob', 'AP', 14),
    b('Jdt', 'Judith', 'Jdt', 'AP', 16),
    b('EsthGr', 'Greek Esther', 'EsthGr', 'AP', 16),
    b('Wis', 'Wisdom of Solomon', 'Wis', 'AP', 19),
    b('Sir', 'Sirach', 'Sir', 'AP', 51),
    b('Bar', 'Baruch', 'Bar', 'AP', 6),
    b('EpJer', 'Epistle of Jeremiah', 'EpJer', 'AP', 1),
    b('PrAzar', 'Prayer of Azariah', 'PrAzar', 'AP', 1),
    b('Sus', 'Susanna', 'Sus', 'AP', 1),
    b('Bel', 'Bel and the Dragon', 'Bel', 'AP', 1),
    b('1Macc', '1 Maccabees', '1Macc', 'AP', 16),
    b('2Macc', '2 Maccabees', '2Macc', 'AP', 15),
    b('1Esd', '1 Esdras', '1Esd', 'AP', 9),
    b('2Esd', '2 Esdras', '2Esd', 'AP', 16),
    b('PrMan', 'Prayer of Manasseh', 'PrMan', 'AP', 1),
    b('AddPs', 'Additional Psalm', 'AddPs', 'AP', 1),
    b('3Macc', '3 Maccabees', '3Macc', 'AP', 7),

    // ── New Testament ──────────────────────────────
    b('Matt', 'Matthew', 'Matt', 'NT', 28),
    b('Mark', 'Mark', 'Mark', 'NT', 16),
    b('Luke', 'Luke', 'Luke', 'NT', 24),
    b('John', 'John', 'John', 'NT', 21),
    b('Acts', 'Acts', 'Acts', 'NT', 28),
    b('Rom', 'Romans', 'Rom', 'NT', 16),
    b('1Cor', '1 Corinthians', '1Cor', 'NT', 16),
    b('2Cor', '2 Corinthians', '2Cor', 'NT', 13),
    b('Gal', 'Galatians', 'Gal', 'NT', 6),
    b('Eph', 'Ephesians', 'Eph', 'NT', 6),
    b('Phil', 'Philippians', 'Phil', 'NT', 4),
    b('Col', 'Colossians', 'Col', 'NT', 4),
    b('1Thess', '1 Thessalonians', '1Thess', 'NT', 5),
    b('2Thess', '2 Thessalonians', '2Thess', 'NT', 3),
    b('1Tim', '1 Timothy', '1Tim', 'NT', 6),
    b('2Tim', '2 Timothy', '2Tim', 'NT', 4),
    b('Titus', 'Titus', 'Titus', 'NT', 3),
    b('Phlm', 'Philemon', 'Phlm', 'NT', 1),
    b('Heb', 'Hebrews', 'Heb', 'NT', 13),
    b('Jas', 'James', 'Jas', 'NT', 5),
    b('1Pet', '1 Peter', '1Pet', 'NT', 5),
    b('2Pet', '2 Peter', '2Pet', 'NT', 3),
    b('1John', '1 John', '1John', 'NT', 5),
    b('2John', '2 John', '2John', 'NT', 1),
    b('3John', '3 John', '3John', 'NT', 1),
    b('Jude', 'Jude', 'Jude', 'NT', 1),
    b('Rev', 'Revelation', 'Rev', 'NT', 22),
] as const;

// ── Lookup maps (built once) ──────────────────────────────

const byOsis = new Map<string, BookMeta>();
const byName = new Map<string, BookMeta>();
const byAbbrev = new Map<string, BookMeta>();

for (const book of BOOKS) {
    byOsis.set(book.osisId, book);
    byName.set(book.name.toLowerCase(), book);
    byAbbrev.set(book.abbrev.toLowerCase(), book);
}

/** Look up a book by OSIS ID (e.g. "Gen"), full name, or abbreviation. */
export function findBook(query: string): BookMeta | undefined {
    const q = query.trim();
    return byOsis.get(q) ?? byName.get(q.toLowerCase()) ?? byAbbrev.get(q.toLowerCase());
}

/** All OT books. */
export const OT_BOOKS = BOOKS.filter((b) => b.testament === 'OT');

/** All NT books. */
export const NT_BOOKS = BOOKS.filter((b) => b.testament === 'NT');

/** All Apocrypha/Deuterocanon books. */
export const AP_BOOKS = BOOKS.filter((b) => b.testament === 'AP');
