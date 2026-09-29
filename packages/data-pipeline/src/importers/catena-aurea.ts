/**
 * Catena Aurea (Aquinas, Newman's Oxford translation 1841-45) from the
 * page-structured OCR of the 1841 scans (issue #85).
 *
 * The printed layout is regular: "CHAP. N." on its own line; a lemma block
 * of numbered Gospel verses in larger type; then the chain of Fathers,
 * each excerpt opening with the Father's name in small capitals (OCR gives
 * them in upper case: "PSEUDO-CHRYS.", "REMIG."). The outer margin carries
 * the citation for each excerpt ("Aug. De Con. Evan. ii. 6.") and "Ver. N."
 * markers saying which verse of the lemma the following excerpts discuss.
 * The margin is separated from the running text by column (djvu-xml.ts),
 * never guessed from the words.
 *
 * One CommentaryEntry per lemma block, which is the Catena's own unit;
 * verse markers become headings inside it. Every block records the leaves
 * and printed pages it was read from.
 */

import type { CommentarySourceLocator, RawCommentaryEntry } from '@codex-scriptura/core';
import { pageLines, scanMetrics, type OcrPage, type PageLine } from './djvu-xml.js';

export type Gospel = 'Matt' | 'Mark' | 'Luke' | 'John';

export type CatenaExcerpt = {
    /** Display name after normalisation ("Pseudo-Chrysostom"); "Gloss" for the Glossa Ordinaria. */
    author: string;
    /** The OCR token as printed, for the report. */
    token: string;
    /** Margin citation joined from its fragments, e.g. "Aug. De Con. Evan. ii. 6." */
    citation?: string;
    /** Verse within the lemma the margin marked before this excerpt, when it did. */
    verse?: number;
    text: string;
    /** The scan leaf the excerpt's author token was read on, for page-by-page review. */
    leaf: number;
};

/** A re-quotation the chain makes of part of the lemma, set in lemma type, with the excerpts that follow it. */
export type CatenaContinuation = { lemma: string; excerpts: CatenaExcerpt[] };

export type CatenaBlock = {
    chapter: number;
    verseStart: number;
    verseEnd: number;
    lemma: string;
    excerpts: CatenaExcerpt[];
    /** Inner re-quotations of the lemma with their excerpts, in order after `excerpts`. */
    continuations: CatenaContinuation[];
    source: CommentarySourceLocator;
};

export type CatenaParseReport = {
    blocks: number;
    excerpts: number;
    /** Lemma blocks whose first verse number the OCR lost; the range was inferred from the previous block. */
    inferredStarts: string[];
    /** Verse paragraphs inside a lemma whose number the OCR damaged, with the number read or inferred for them. */
    inferredNumbers: string[];
    /** Upper-case tokens that looked like an author but matched nothing; kept as text. */
    unknownTokens: Record<string, number>;
    /** Mixed-case names read as mentions in the text rather than attributions, with what followed them. */
    mentions: Record<string, number>;
    /** OCR tokens repaired to a known author, e.g. "RKMIG." -> "REMIG." */
    repairedTokens: Record<string, string>;
    /** Verses of each chapter no lemma block covered. */
    uncovered: Record<number, number[]>;
};

/** Abbreviations as Newman's edition prints them, with the display name. */
export const AUTHORS: Record<string, string> = {
    'AUG': 'Augustine', 'PSEUDO-AUG': 'Pseudo-Augustine',
    'CHRYS': 'Chrysostom', 'CHRYSOST': 'Chrysostom', 'PSEUDO-CHRYS': 'Pseudo-Chrysostom',
    'JEROME': 'Jerome', 'PSEUDO-JEROME': 'Pseudo-Jerome',
    'HILARY': 'Hilary', 'GLOSS': 'Gloss', 'RABAN': 'Rabanus', 'RABANUS': 'Rabanus',
    'REMIG': 'Remigius', 'ORIGEN': 'Origen', 'GREG': 'Gregory', 'AMBROSE': 'Ambrose',
    'BEDE': 'Bede', 'CYRIL': 'Cyril', 'THEOPHYL': 'Theophylact', 'THEOPHYLACT': 'Theophylact',
    'LEO': 'Leo', 'ISID': 'Isidore', 'ANSELM': 'Anselm', 'ATHAN': 'Athanasius', 'BASIL': 'Basil',
    'CYPRIAN': 'Cyprian', 'EUSEB': 'Eusebius', 'SEVERIAN': 'Severianus', 'THEODORET': 'Theodoret',
    'DAMASC': 'John Damascene', 'ALCUIN': 'Alcuin', 'HAYMO': 'Haymo', 'APOLLINARIUS': 'Apollinarius',
    'AMBROSIASTER': 'Ambrosiaster', 'DIDYMUS': 'Didymus', 'EPIPHAN': 'Epiphanius', 'GREG. NAZ': 'Gregory Nazianzen',
    'GREG. NYSS': 'Gregory of Nyssa', 'MAXIMUS': 'Maximus', 'PROSPER': 'Prosper', 'TITUS': 'Titus of Bostra',
    'VICTOR': 'Victor of Antioch', 'CHRYSOLOGUS': 'Peter Chrysologus', 'ID': 'Id.',
    'AUGUSTINE': 'Augustine', 'PSEUDO-CHRYSOSTOM': 'Pseudo-Chrysostom', 'GREGORY': 'Gregory', 'PSEUDO-ATHAN': 'Pseudo-Athanasius',
    'PSEUDO-ORIGEN': 'Pseudo-Origen', 'THEODOTUS': 'Theodotus', 'NEMESIUS': 'Nemesius', 'CONC. EPH': 'Council of Ephesus',
    'PSEUDO-BASIL': 'Pseudo-Basil', 'PSEUDO-AMBROSE': 'Pseudo-Ambrose', 'HIPPOLYTUS': 'Hippolytus', 'IRENAEUS': 'Irenaeus',
    'JUSTIN': 'Justin Martyr', 'CLEMENT': 'Clement', 'TERTULLIAN': 'Tertullian', 'FULGENTIUS': 'Fulgentius', 'CASSIAN': 'Cassian',
    'GAUDENTIUS': 'Gaudentius', 'PASCHASIUS': 'Paschasius', 'THEOPHANES': 'Theophanes', 'PHOTIUS': 'Photius', 'AMPHILOCHIUS': 'Amphilochius',
    // Shorter abbreviations and the multi-word names the Luke and John volumes use
    'HIL': 'Hilary', 'CHRYSOL': 'Peter Chrysologus', 'AMBR': 'Ambrose', 'ORIG': 'Origen', 'AUGUST': 'Augustine', 'THEOPH': 'Theophylact',
    'CYR': 'Cyril', 'REMIGIUS': 'Remigius', 'REM': 'Remigius', 'ISIDORE': 'Isidore', 'BED': 'Bede', 'SEVER': 'Severianus', 'CHRYSOLOG': 'Peter Chrysologus', 'CYRIL OF ALEXANDRIA': 'Cyril of Alexandria', 'CYRIL OF JERUSALEM': 'Cyril of Jerusalem', 'CYRIL OF JERUS': 'Cyril of Jerusalem', 'GREGORY OF NYSSA': 'Gregory of Nyssa', 'ATHANASIUS': 'Athanasius', 'EUSEBIUS': 'Eusebius', 'MAXIM': 'Maximus', 'DAMASCENE': 'John Damascene', 'DIONYS': 'Dionysius', 'DIONYSIUS AR': 'Dionysius', 'JOSEPHUS': 'Josephus',
    'PSEUDO-DIONYSIUS': 'Pseudo-Dionysius', 'PSEUDO-DIONYS': 'Pseudo-Dionysius', 'GREEK EX': 'Greek Expositor', 'GREEK EXPOSITOR': 'Greek Expositor',
    'TITUS BOST': 'Titus of Bostra', 'TIT. BOST': 'Titus of Bostra', 'EPIPH': 'Epiphanius', 'PETRUS ALFONSUS': 'Petrus Alfonsus', 'GREGORY NYSS': 'Gregory of Nyssa', 'ISIDORE PELEUS': 'Isidore of Pelusium', 'ISID. PELEUS': 'Isidore of Pelusium', 'SEVERUS': 'Severus',
    'PROCLUS': 'Proclus', 'ASTERIUS': 'Asterius', 'APOLLINARIS': 'Apollinarius', 'BASIL. SEL': 'Basil of Seleucia', 'GREG. THAUM': 'Gregory Thaumaturgus',
};

// Any upper-case word ending in a period may be an author token; resolveAuthor decides. OCR noise
// before a token ("^rue- REMIG.") is common enough that sentence punctuation cannot be required.
// Small capitals come out of the OCR in upper case, sometimes with lower-case glyphs mixed in
// ("PsEUDO-CiiRYs."), sometimes with a space before the period ("RABANUS ;"). A candidate needs
// at least three capitals; resolveAuthor decides whether it names anyone.
// A second word belongs to the token for the names the edition prints in two parts ("GREG. NYSS.", "GREEK EX.", "TITUS BOST.")
// The second word of a two-word name in whatever case the OCR gave it ("NYSS", "Nyss", "BosT")
const SECOND = '(?:' + ['NAZ', 'NYSS', 'EPH', 'MAG', 'SYR', 'MOPS', 'SEL', 'THAUM', 'EX', 'EXPOSITOR', 'BOST', 'PELEUS', 'ALFONSUS'].map((w) => [...w].map((c) => `[${c}${c.toLowerCase()}]`).join('')).join('|') + '|[Bb][Oo][Ss][RrTt]?)';
// "CYRIL OF ALEXANDRIA", "GREGORY OF NYSSA": the edition's three-word forms
const OF_PLACE = '(?:\\s[Oo][Ff]\\s[A-Z][A-Za-z]{3,})';
// The space after the token's punctuation may be lost ("AMBROSE;But"): a capital may follow the mark directly
// The "PSEUDO-" prefix as the OCR damages it ("PSECJDO-", "PSKUDO-", "PsEuno-", "PSEUDO_"): any short word on P
// before the dash, judged by resolveAuthor. A speck after the mark ("CHRYS.*", "AUG.^") or a few glued letters
// ("PSEUDO-CHRYS.cjtt") is noise
const PSEUDO = '(?:P[A-Za-z]{4,6}[-_]\\s?)?';
// The mark: a full stop, semicolon, comma, colon or bullet, with a speck before or after it ("BeDE';", "CHrys°.",
// "CHRYS.*"), or, at a line's end, nothing at all before the next capitalised word ("AuG He said")
const MARK = `(?:[*'\\u2019\\u00b0\\d]{0,2}\\s?[.;,:\\u2022^](?:[*'\\u2019^]|[a-z]{1,4}\\.?(?=\\s))?(?:\\s|(?=[A-Z]))|(?=\\s[A-Z][a-z]))`;
const TOKEN = new RegExp(`(?:^|(?<=[\\s.]))[."'\\u201c\\u2022]?(${PSEUDO}[A-Z][A-Za-z£$01^?'\\u2019]{1,}(?:\\.?\\s?${SECOND}|${OF_PLACE})?)${MARK}`, 'g');
const AT_START = new RegExp(`^[.\\u2022]?${PSEUDO}[A-Z][A-Za-z£$01^?'\\u2019]{1,}(?:\\.?\\s?${SECOND}|${OF_PLACE})?${MARK}`);

/** Glyphs the OCR substitutes inside small capitals: "Au£." for "AUG.", "CHRY$." for "CHRYS.", "0RIGEN." for "ORIGEN." */
function normaliseGlyphs(raw: string): string {
    // Ligatures the OCR sees in small capitals: "BfiDE" is BEDE, "CflRYS" is CHRYS
    return raw.replace(/fi/g, 'E').replace(/fl/g, 'H').toUpperCase().replace(/£/g, 'G').replace(/\$/g, 'S').replace(/0/g, 'O').replace(/1/g, 'I').replace(/[\^?'\u2019]/g, '')
        // "TIR. BOS." and "TIRUS BOSR." are TIT. BOST. with t read as r and the final t lost
        .replace(/^TIR(US)?\b/, 'TIT$1').replace(/\bBOS[RT]?$/, 'BOST');
}

/** Abbreviated author forms never occur as ordinary words, so a mixed-case OCR of them ("Chrys.", "Remig.") is safe to take. */
const ABBREVIATED = new Set(Object.keys(AUTHORS).filter((k) => k.length <= 6 || k.includes('. ') || k.startsWith('PSEUDO-')));
/** Words before a full name that make it a mention in prose ("according to Augustine.") rather than an attribution. */
const FUNCTION_WORDS = new Set(['and', 'or', 'the', 'a', 'an', 'such', 'what', 'that', 'being', 'of', 'in', 'as', 'for', 'but', 'so', 'not', 'to', 'is', 'are', 'was', 'which', 'who', 'by', 'with', 'from', 'this', 'these', 'he', 'his', 'it', 'its', 'we', 'our', 'you', 'they', 'on', 'at', 'if', 'when', 'then', 'there', 'here', 'because', 'since', 'whose', 'whom']);
// Glyph pairs the OCR confuses in small capitals, read as written then as meant
const CONFUSIONS = new Set(['DU', 'CG', 'VU', 'OQ', 'QO', 'IL', 'LI', 'IT', 'TI', 'EF', 'FE', 'BR', 'RB', 'HN', 'NH', 'OC', 'CO', 'KE', 'EK', 'AR', 'RA', 'SG', 'GS', 'PD', 'DP', 'RE', 'ER', 'TU', 'UT', 'ND', 'DN', 'KI', 'IK', 'JG', 'GJ', 'QG', 'GQ']);

/** Whether `read` is `known` with every differing glyph a confusion the OCR makes ("BKDK" for "BEDE", "REDE" for "BEDE"). */
function confusedForm(read: string, known: string): boolean {
    if (read.length !== known.length) return false;
    let diff = 0;
    for (let i = 0; i < read.length; i++) if (read[i] !== known[i]) { diff++; if (!CONFUSIONS.has(read[i] + known[i])) return false; }
    return diff >= 1 && diff <= 2;
}
const MENTION_BEFORE = /(?:^|\s)(?:of|as|by|to|with|from|in|on|says|saith|said|and|or|than|for|St\.|S\.|St|blessed|holy)\s*$/i;

function isTokenCandidate(raw: string, before = ''): boolean {
    const capitals = (raw.match(/[A-Z]/g) ?? []).length;
    if (capitals >= 3) return true;
    const key = normaliseGlyphs(raw);
    // Fewer capitals is acceptable only when the glyph-normalised token is exactly a known author,
    // and either two of them are capitals ("ID.") or a noise glyph shows small capitals were read ("Au£.")
    if ((capitals >= 2 || /[£$01^]/.test(raw)) && key in AUTHORS) return true;
    // Small capitals of a short abbreviation read with two capitals and one confused glyph ("BepE;", "AtG.")
    if (capitals >= 2 && key.length <= 4) for (const known of Object.keys(AUTHORS)) if (known.length === key.length && confusedForm(key, known)) return true;
    // Some scans' OCR read the small capitals as ordinary capitalised words ("Chrys.", "Ambrose ;"):
    // an abbreviation is taken outright, a full name only where prose would not put it
    if (capitals === 1 && key in AUTHORS) {
        if (ABBREVIATED.has(key)) return true;
        return !MENTION_BEFORE.test(before);
    }
    // A capitalised word one glyph away from a known name of five letters or more ("Chuys.", "Oriqen;") is
    // a damaged token, not a word of the text; the sentence-boundary rule for mixed case still applies
    if ((capitals >= 1 || /[£$01^]/.test(raw)) && key.length >= 5) {
        for (const known of Object.keys(AUTHORS)) if (known.length >= 5 && known[0] === key[0] && editDistance(known, key) === 1 && !MENTION_BEFORE.test(before)) return true;
    }
    return false;
}

/** Offset of the first author token in a line, or -1. */
/**
 * A mixed-case name that is a mention in the text, not an attribution: one not at a sentence boundary ("called
 * Didymus, and Nathanael"), or one followed by a plain lower-case word ("the Gloss, for when he wrote"). Only plain
 * words count for the second, since the OCR also gives "Chrys. lliis was" for "CHRYS. This was". `before` is the
 * text preceding the match, from the previous line where the match opens this one.
 */
function mentionOf(text: string, m: RegExpMatchArray, before: string): string | null {
    const mixed = (m[1].match(/[A-Z]/g) ?? []).length === 1;
    if (!mixed) return null;
    if (before.trim() && !/[.;:?!]["'\u201d\u2019]?\s*$/.test(before)) return `${m[0].trim()} (mid-sentence)`;
    const rest = text.slice(m.index! + m[0].length);
    const following = /^([a-z]+)\b/.exec(rest)?.[1];
    if (following && (/,\s$/.test(m[0]) || FUNCTION_WORDS.has(following))) return `${m[0].trim()} ${rest.slice(0, 12)}`;
    return null;
}

/** Offset of the first author token in a line, or -1; `before` is the previous line, for a token at the line's start. */
function firstTokenAt(line: string, before = ''): number {
    for (const m of (line + ' ').matchAll(TOKEN)) {
        const prior = m.index! > 0 ? line.slice(Math.max(0, m.index! - 12), m.index!) : before.slice(-12);
        if (mentionOf(line + ' ', m, prior)) continue;
        if (resolveAuthor(m[1], undefined, prior)) return m.index! + m[0].indexOf(m[1]);
    }
    return -1;
}

function editDistance(a: string, b: string): number {
    const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
}

/** The author an upper-case token names, repairing small OCR damage ("RKMIG" -> "REMIG"); null when it is not an author. */
// Forms that are also ordinary words or their neighbours ("Seven" is one glyph from SEVER., "Bed" from BED.): only
// small capitals, read with at least two capitals, are these
const SMALL_CAPITALS_ONLY = new Set(['SEVER', 'BED', 'REM']);

export function resolveAuthor(raw: string, report?: CatenaParseReport, before = ''): { key: string; name: string } | null {
    const found = resolveAuthorForm(raw, report, before);
    if (found && SMALL_CAPITALS_ONLY.has(found.key) && (raw.match(/[A-Z]/g) ?? []).length < 2) return null;
    return found;
}

function resolveAuthorForm(raw: string, report?: CatenaParseReport, before = ''): { key: string; name: string } | null {
    // "TD." and "Ip." are the OCR's "ID." (idem), confusions of I with T and d with p in small capitals
    if (raw === 'TD' || raw === 'Ip' || raw === 'IP') return { key: 'ID', name: AUTHORS['ID'] };
    // A damaged "PSEUDO-" prefix: within two glyphs of it, and the rest an author
    const pseudo = /^(P[A-Za-z]{4,6})[-_]\s?(.+)$/.exec(raw);
    if (pseudo && pseudo[1].toUpperCase() !== 'PSEUDO' && editDistance(pseudo[1].toUpperCase(), 'PSEUDO') <= 2) {
        const rest = resolveAuthorForm(pseudo[2], report, before);
        if (rest && AUTHORS[`PSEUDO-${rest.key}`]) { if (report) report.repairedTokens[raw] = `PSEUDO-${rest.key}`; return { key: `PSEUDO-${rest.key}`, name: AUTHORS[`PSEUDO-${rest.key}`] }; }
        return null;
    }
    if (pseudo) raw = `PSEUDO-${pseudo[2]}`;
    if (!isTokenCandidate(raw, before)) return null;
    const token = normaliseGlyphs(raw);
    const key = token.replace(/\.\s?/g, '. ').replace(/\.$/, '').replace(/\. /g, '. ').trim();
    const compact = key.replace(/\.\s/g, '. ');
    if (AUTHORS[compact]) return { key: compact, name: AUTHORS[compact] };
    // "GREG NYSS" / "GREG. NYSS" / "GREEK EX" are one name however the period fell
    const spaced = compact.replace(/\. /g, ' ');
    const dotted = compact.replace(/ (?=[A-Z])/g, '. ');
    // The OCR reads H as two strokes: "CIIRYS" is CHRYS
    const unstroked = compact.replace(/II/g, 'H');
    for (const variant of [spaced, dotted, unstroked]) if (AUTHORS[variant]) { if (report && variant === unstroked && unstroked !== compact) report.repairedTokens[token] = variant; return { key: variant, name: AUTHORS[variant] }; }
    // A three-letter token in small capitals one glyph from a three-letter name, and only by a confusion the OCR
    // makes ("ADG." for "AUG."): "LET" is never "LEO"
    if (compact.length === 3 && (raw.match(/[A-Z]/g) ?? []).length >= 2) {
        for (const known of Object.keys(AUTHORS)) {
            if (known.length !== 3) continue;
            const at = [0, 1, 2].filter((i) => known[i] !== compact[i]);
            if (at.length === 1 && CONFUSIONS.has(compact[at[0]] + known[at[0]])) { if (report) report.repairedTokens[token] = known; return { key: known, name: AUTHORS[known] }; }
        }
        return null;
    }
    if (compact.length < 4) return null;
    // Glyph confusions, in any position and however short the name; the two-stroke H is undone first ("CHIIYS")
    for (const form of unstroked !== compact ? [compact, unstroked] : [compact]) for (const known of Object.keys(AUTHORS)) if (known.length >= 4 && confusedForm(form, known)) { if (report) report.repairedTokens[token] = known; return { key: known, name: AUTHORS[known] }; }
    // Repairs keep the first letter and allow one wrong glyph per five characters, so "HERE" never becomes "BEDE"
    let best: { key: string; d: number } | undefined;
    // Small capitals the OCR read with a wrong first glyph ("JLABANUS") are unmistakably a token, so a long one may repair
    // across it; a word of the text never has three capitals
    const smallCaps = (raw.match(/[A-Z]/g) ?? []).length >= 3 && compact.length >= 5;
    for (const form of unstroked !== compact ? [compact, unstroked] : [compact]) for (const known of Object.keys(AUTHORS)) {
        if (known.length < 4 || (known[0] !== form[0] && !smallCaps) || Math.abs(known.length - form.length) > 2) continue;
        const d = editDistance(known, form);
        // One wrong glyph up to six characters, two beyond: "CHRIST" must not become "CHRYS"; across a wrong
        // first glyph only one, and only from seven ("JLABANUS"), "HABAN" being one away from "RABAN"
        const allowed = known[0] !== form[0] ? (form.length >= 7 ? 2 : 1) : form.length <= 6 ? 1 : 2;
        if (d <= allowed && (!best || d < best.d)) best = { key: known, d };
    }
    if (best) {
        if (report) report.repairedTokens[token] = best.key;
        return { key: best.key, name: AUTHORS[best.key] };
    }
    return null;
}

// "CHAP. XVI." in the first OCR batch, "Chap. XVI." in the second, with the OCR's damage to either word
// ("CHAR XX.", "CHAP, xyiii.", "XXIL"): the numeral is read leniently and checked against the chapter expected next
// The numeral as either OCR gives it: 'XVI', 'xyiii', or with a digit one for the letter I ('11.' for II, '1II.')
const CHAPTER = /^CHA[PR][.,]?\s*([IVXLCivxlcy1l]{1,7})[.,]?\s*$/;
// The second batch sometimes runs the head into the first lemma line: "Chap. XVI. 1. The Pharisees also with the"
const RUN_IN_CHAPTER = /^Cha[pr][.,]?\s*([IVXLCivxlcy1l]{1,7})[.,]?\s+(?=\d{1,3}[.,]\s)/i;

const ROMAN_DIGITS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
export function toRoman(n: number): string {
    return (n >= 10 ? 'X'.repeat(Math.floor(n / 10)) : '') + ROMAN_DIGITS[n % 10];
}

/**
 * The chapter a head opens, or null when the line is not a new chapter.
 * Chapters are printed in order, so only the next chapter can open here:
 * a numeral reading as the next chapter opens it, and a damaged numeral
 * one glyph away from it is repaired to it. Anything else is a running
 * head the OCR left without its page number ("CHAP. XXI." mid-page) or
 * noise, and is ignored rather than guessed at.
 */
export function chapterFromHead(numeral: string, previous: number, report?: CatenaParseReport, expectedFirst?: number): number | null {
    const cleaned = numeral.replace(/[1l]/g, 'I').toUpperCase().replace(/Y/g, 'V');
    if (previous === 0) {
        const printed = /^[IVXLC]+$/.test(cleaned) && roman(cleaned) >= 1 && roman(cleaned) <= 150 ? roman(cleaned) : null;
        // A scan part opens mid-Gospel at a chapter the scan map knows: its first head is that chapter, or the
        // one after it when the OCR lost the first head entirely; "XL" for "XI" is repaired, never taken as 40
        if (expectedFirst === undefined) return printed;
        if (printed === expectedFirst || printed === expectedFirst + 1) return printed;
        if (editDistance(cleaned, toRoman(expectedFirst)) <= 1) {
            if (report) report.repairedTokens[`CHAP. ${numeral}`] = `CHAP. ${toRoman(expectedFirst)}`;
            return expectedFirst;
        }
        return null;
    }
    const expected = previous + 1;
    if (cleaned === toRoman(expected)) return expected;
    if (/^[IVXLC]+$/.test(cleaned) && roman(cleaned) === previous) return null;
    if (editDistance(cleaned, toRoman(expected)) <= 1 && editDistance(cleaned, toRoman(previous)) > 0) {
        if (report) report.repairedTokens[`CHAP. ${numeral}`] = `CHAP. ${toRoman(expected)}`;
        return expected;
    }
    return null;
}
// A lemma verse line: "7. But when he saw", "Ver. 4. And the same John", or a range "3-6. And Judas begat"
// The verse number as the OCR gives it: "16.", "1 6.", "1 .", "4-" (a dash for the period), "8 - 1 1 ." for a range,
// and "Ver. I." in roman at a chapter's start
const NUM = '(\\d{1,3}|\\d\\s\\d{1,2}|\\d{2}\\s\\d)';
const LEMMA_LINE = new RegExp(`^(?:Ver\\.\\s*)?${NUM}(?:\\s*[-\\u2013\\u2014]\\s*${NUM})?\\s?(?:[.,]|-(?!\\s?\\d))\\s+(.*)$`, 'i');
const LEMMA_ROMAN = /^Ver\.\s*([IVXL]{1,7})[.,]\s+(.*)$/;
const END_MATTER = /^(?:ERRATA|INDEX)\b/;
// Inside an open lemma a further verse paragraph whose number the OCR damaged ("3L Insomuch", "4b*. Who"):
// the digits it did read, with the usual substitutions, or failing that the verse after the last
const DAMAGED_NUMBER = /^([0-9lLIoO](?:\s?[0-9lLIoOb*'\u2019\]\)]){0,3})\s?[.,]?\s+(?=["'\u2018\u201c(]?[A-Z])(.*)$/;
// At a block's opening the same, in lemma type after a finished chain: "2L Now when all the people", "12 And it came to pass",
// or a number the OCR made a word of ("Qib. And fear came on all")
const DAMAGED_OPENING = /^([0-9lLIoOQGSB][0-9lLIiobO*'\u2019.]{0,3}\.?)\s+(?=["'\u2018\u201c(]?[A-Z])(.*)$/;
const readDigits = (s: string): number | undefined => {
    const digits = s.replace(/[lLI\]]/g, '1').replace(/[oO]/g, '0').replace(/[^0-9]/g, '');
    return digits.length === s.replace(/[*'\u2019.\s]/g, '').length && digits.length ? Number(digits) : undefined;
};
const lemmaNumber = (s: string | undefined): number | undefined => (s === undefined ? undefined : Number(s.replace(/\s/g, '')));
const VERSE_MARK = /\bVer\.\s*([ivxl]+|\d+)\b\.?/i;
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

export function roman(s: string): number {
    const r = s.toUpperCase();
    let total = 0;
    for (let i = 0; i < r.length; i++) {
        const v = ROMAN[r[i]] ?? 0;
        total += i + 1 < r.length && (ROMAN[r[i + 1]] ?? 0) > v ? -v : v;
    }
    return total;
}

/** OCR noise the 1841 type produces reliably enough to fix mechanically. */
export function cleanOcr(text: string): string {
    return text
        // A footnote reference the OCR glued to the word before it ("Christ6", "the3")
        .replace(/([A-Za-z]{3,})\d(?=[\s,.;:)])/g, '$1')
        .replace(/\b(?:8\$|\$|S|f)?[fy]?c\.\.?(?=\s|$)/g, (m) => (/^[8$Sf]/.test(m) || m.startsWith('fy') ? '&c.' : m))
        .replace(/8\$c\./g, '&c.').replace(/\$c\./g, '&c.')
        .replace(/\s+([,;:.?!])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function joinLines(lines: string[]): string {
    let out = '';
    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (out.endsWith('-') && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
        else out = out ? `${out} ${t}` : t;
    }
    return out;
}

type Open = {
    block: CatenaBlock;
    lemmaLines: string[];
    /** Verse numbers the lemma lines carried, in order. */
    numbers: number[];
    /** Running text of the chain, with margin fragments attached by line and the leaf each line is on. */
    chain: { text: string; margin: string; leaf: number }[];
    inLemma: boolean;
    /** Segments after an inner re-quotation: each collects its lemma lines and then its own chain. */
    parts: { lemmaLines: string[]; chain: { text: string; margin: string; leaf: number }[]; inLemma: boolean }[];
};

const LEMMA_INDENT = 50;

/**
 * Parse one scan's pages into lemma blocks. The edition sets each verse
 * of the Gospel lemma as an indented, numbered line with its continuation
 * flush left, and the chain of Fathers follows flush left, each excerpt
 * opening with an author token. So a block opens on an indented numbered
 * line, extends its lemma over further indented numbered lines and their
 * unindented continuations, and starts its chain at the first line that
 * opens with an author token; it closes at the next block or chapter
 * heading. `verseCounts` (the Authorized Version's, which the edition
 * follows) bounds the numbers a lemma may carry. A printed page number
 * the OCR missed is carried forward from the last page that had one.
 */
/**
 * A correction to one OCR line before parsing, read from the page image:
 * for damage the chain splitter must see repaired, above all an author
 * token the OCR made a word of ("Auo. Mark suys" for "AUG. Mark says").
 * `find` must occur in exactly one line of the leaf, once.
 */
export type LineCorrection = { item: string; leaf: number; find: string; replace: string; note?: string };

export type ParseOptions = {
    lineCorrections?: LineCorrection[];
    /** The chapter this scan part opens with, from the scan map, so its first head is read against it. */
    firstChapter?: number;
};

export function parseCatenaPages(pages: OcrPage[], item: string, verseCounts: Record<number, number>, report: CatenaParseReport = emptyReport(), options: ParseOptions = {}): CatenaBlock[] {
    const metrics = scanMetrics(pages);
    let prevMain = '';
    const fixes = (options.lineCorrections ?? []).filter((c) => c.item === item);
    const applied = new Map<LineCorrection, number>(fixes.map((c) => [c, 0]));
    const fixLine = (leaf: number, main: string): string => {
        for (const c of fixes) {
            if (c.leaf !== leaf) continue;
            const at = main.indexOf(c.find);
            if (at < 0) continue;
            if (main.indexOf(c.find, at + 1) >= 0) throw new Error(`[catena] line correction "${c.find}" occurs more than once on leaf ${leaf} of ${item}`);
            main = main.slice(0, at) + c.replace + main.slice(at + c.find.length);
            applied.set(c, applied.get(c)! + 1);
        }
        return main;
    };
    const blocks: CatenaBlock[] = [];
    let chapter = 0;
    let open: Open | null = null;
    let lastPrinted: { page: number; leaf: number } | undefined;

    const close = () => {
        if (!open) return;
        const b = open.block;
        if (open.numbers.length === 0) {
            b.verseStart = b.verseEnd = lastVerseEnd(blocks, b.chapter) + 1;
            report.inferredStarts.push(`${item} ${b.chapter}:${b.verseStart} (leaf ${b.source.leafStart})`);
        } else {
            b.verseStart = open.numbers[0];
            b.verseEnd = Math.max(...open.numbers);
        }
        b.lemma = cleanOcr(joinLines(open.lemmaLines).replace(/(^|\s)(\d{1,3})(?:\s*[-\u2013\u2014]\s*\d{1,3})?\.\s+/g, '$1'));
        b.excerpts = splitChain(open.chain, report);
        b.continuations = open.parts.map((p) => ({ lemma: cleanOcr(joinLines(p.lemmaLines)), excerpts: splitChain(p.chain, report) }));
        blocks.push(b);
        open = null;
    };

    for (const page of pages) {
        const { lines, printedPage: read } = pageLines(page, metrics);
        if (read && /^\d+$/.test(read)) lastPrinted = { page: Number(read), leaf: page.leaf };
        const printedPage = read ?? (lastPrinted ? String(lastPrinted.page + (page.leaf - lastPrinted.leaf)) : undefined);
        for (const line of lines) {
            // A stray mark the recogniser put before a verse number ("-38. And all the people") is not the line's start
            let main = fixLine(page.leaf, line.main.trim()).replace(/^[-\u2013\u2014\u2022'"`~^*]{1,2}\s?(?=\d)/, '');
            if (!main) continue;
            const before = prevMain;
            prevMain = main;
            // The volume's end matter ("ERRATA, PART I.") is not chain
            if (END_MATTER.test(main)) { close(); chapter = 0; break; }
            const chap = CHAPTER.exec(main);
            if (chap) {
                const next = chapterFromHead(chap[1], chapter, report, options.firstChapter);
                if (next !== null) { close(); chapter = next; continue; }
            }
            const runIn = RUN_IN_CHAPTER.exec(main);
            if (runIn) {
                const next = chapterFromHead(runIn[1], chapter, report, options.firstChapter);
                if (next !== null) { close(); chapter = next; main = main.slice(runIn[0].length); }
            }
            if (chapter === 0) continue;

            const maxVerse = verseCounts[chapter] ?? 200;
            const romanLemma = LEMMA_ROMAN.exec(main);
            let numbered = romanLemma ? [romanLemma[0], String(roman(romanLemma[1])), undefined, romanLemma[2]] as unknown as RegExpExecArray : LEMMA_LINE.exec(main);
            if (!numbered && open?.inLemma && !open.parts.length && line.indent >= LEMMA_INDENT) {
                const damaged = DAMAGED_NUMBER.exec(main);
                if (damaged) {
                    const n = readDigits(damaged[1]) ?? open.block.verseEnd + 1;
                    report.inferredNumbers.push(`${item} ${chapter}:${n} from "${damaged[1]}" (leaf ${page.leaf})`);
                    numbered = [damaged[0], String(n), undefined, damaged[2]] as unknown as RegExpExecArray;
                }
            } else if (!numbered && open && !(open.parts.length ? open.parts[open.parts.length - 1] : open).inLemma && line.indent >= LEMMA_INDENT && firstTokenAt(main) !== 0) {
                const damaged = DAMAGED_OPENING.exec(main);
                // A number the OCR read cleanly ("12 And it came to pass") needs no more; an unreadable token
                // ("Qib.") is a verse number only in lemma type
                const read = damaged ? readDigits(damaged[1].replace(/\.$/, '')) : undefined;
                // A verse line has words; a printer's mark the page reader missed ("2 A") has not. Without lemma
                // type to vouch for it, a clean number opens a block only as the verse after the last ("12 And it
                // came to pass" after 11): a footnote marker ("1 Rachel, an ewe") is never that
                const next = open.block.verseEnd + 1;
                if (damaged && main.split(' ').length >= 4 && (read === next || line.height >= bodyHeight(page) * 1.1)) {
                    const n = read ?? open.block.verseEnd + 1;
                    report.inferredNumbers.push(`${item} ${chapter}:${n} from "${damaged[1]}" (leaf ${page.leaf})`);
                    numbered = [damaged[0], String(n), undefined, damaged[2]] as unknown as RegExpExecArray;
                }
            }
            // The looser OCR forms ("1 .", "1 6.") must lead into a verse's opening capital, or "1 . , • -i-" at a page's top is a lemma
            const loose = numbered !== null && (/\d\s[.,-]/.test(numbered[0]) || /\d\s\d/.test(numbered[1])) && !/^["'\u2018\u201c(]?[A-Z]/.test(numbered[3] ?? '');
            const first = loose ? undefined : lemmaNumber(numbered?.[1]), second = lemmaNumber(numbered?.[2]);
            const number = first !== undefined && first >= 1 && first <= maxVerse ? first : undefined;
            const numberEnd = second !== undefined && second >= (number ?? 0) && second <= maxVerse ? second : number;
            const tokenAt = firstTokenAt(main, before);
            const opensAuthor = tokenAt === 0;
            const indented = line.indent >= LEMMA_INDENT;
            // An unnumbered indented line in larger type opens a further lemma block on the same verse
            // (the edition splits a long verse into parts, each with its own chain)
            // Not a sub-verse lemma: a continuation of a word the previous line broke ("remembr-" / "ence they might"),
            // or a line whose type is not clearly larger than the body
            const current = open ? (open.parts.length ? open.parts[open.parts.length - 1] : open) : null;
            const lastChain: string = current && !current.inLemma && current.chain.length ? current.chain[current.chain.length - 1].text : '';
            // A sub-verse lemma follows a finished excerpt, so the chain's last line ends a sentence; and the chain's
            // own re-quotation of the next verse ("It follows, Came Mary Magdalen, &c.") is set in lemma type but is chain
            // nor the line after one ending in an author token, which is that excerpt's first line however the OCR boxed it
            const subVerse: boolean = indented && number === undefined && tokenAt < 0 && current !== null && !current.inLemma
                && line.height >= bodyHeight(page) * 1.15 && main.split(' ').length >= 4 && /[.!?;:)'"\u201d\u2019]\s*$/.test(lastChain)
                && !/^(?:And |Then |Hence |Whence |Wherefore |There |Now |But )?(?:it |there )?follow(?:s|eth)\b/i.test(main)
                && !(/[A-Z]{2,}[A-Za-z-]*\s?[.;:]$/.test(lastChain) && resolveAuthor(/([A-Za-z-]+)\s?[.;:]$/.exec(lastChain)![1]));

            // An inner re-quotation stays inside its block: the edition sets part of a long lemma again, in lemma
            // type, before the chain goes on ("When he speaketh a lie, ..." inside John 8:44-47)
            if (subVerse) {
                open!.parts.push({ lemmaLines: [main], chain: [], inLemma: true });
                continue;
            }
            if (number !== undefined && indented && !opensAuthor) {
                // While the lemma is still open every numbered line extends it: a misread number ("20." for "26.")
                // must not split a block that has no chain yet
                const continues = open?.inLemma && number !== undefined;
                if (!continues) {
                    close();
                    open = {
                        block: { chapter, verseStart: 0, verseEnd: 0, lemma: '', excerpts: [], continuations: [], source: { item, leafStart: page.leaf, leafEnd: page.leaf, ...(printedPage ? { pageStart: printedPage, pageEnd: printedPage } : {}) } },
                        lemmaLines: [], numbers: [], chain: [], inLemma: true, parts: [],
                    };
                }
                open!.numbers.push(number, numberEnd!); open!.block.verseEnd = Math.max(open!.block.verseEnd, numberEnd!);
                open!.lemmaLines.push(numbered![3]);
                continue;
            }
            if (!open) continue;
            open.block.source.leafEnd = page.leaf;
            if (printedPage) open.block.source.pageEnd = printedPage;
            // Lines go to the newest open segment: the block itself, or its last inner re-quotation
            const seg = open.parts.length ? open.parts[open.parts.length - 1] : open;
            if (seg.inLemma) {
                if (tokenAt < 0) { seg.lemmaLines.push(main); continue; }
                // The chain begins mid-line: the words before the first token still belong to the lemma
                if (tokenAt > 0) seg.lemmaLines.push(main.slice(0, tokenAt).trim());
                seg.inLemma = false;
                seg.chain.push({ text: main.slice(tokenAt), margin: line.margin.trim(), leaf: page.leaf });
                continue;
            }
            seg.chain.push({ text: main, margin: line.margin.trim(), leaf: page.leaf });
        }
    }
    close();
    for (const [c, n] of applied) if (n !== 1) throw new Error(`[catena] line correction "${c.find}" on leaf ${c.leaf} of ${item} applied ${n} times, not once`);
    report.blocks += blocks.length;
    report.excerpts += blocks.reduce((n, b) => n + b.excerpts.length, 0);
    for (const [ch, count] of Object.entries(verseCounts)) {
        const covered = new Set<number>();
        for (const b of blocks) if (b.chapter === Number(ch)) for (let v = b.verseStart; v <= b.verseEnd; v++) covered.add(v);
        const missing = Array.from({ length: count }, (_, i) => i + 1).filter((v) => !covered.has(v));
        if (missing.length && blocks.some((b) => b.chapter === Number(ch))) report.uncovered[Number(ch)] = missing;
    }
    return blocks;
}

const bodyHeights = new WeakMap<OcrPage, number>();
function bodyHeight(page: OcrPage): number {
    let h = bodyHeights.get(page);
    if (h === undefined) {
        const hs = page.lines.map((l) => { const ws = l.words.map((w) => w.y2 - w.y1).sort((a, b) => a - b); return ws[Math.floor(ws.length / 2)]; }).sort((a, b) => a - b);
        h = hs[Math.floor(hs.length / 2)] ?? 0;
        bodyHeights.set(page, h);
    }
    return h;
}

function lastVerseEnd(blocks: CatenaBlock[], chapter: number): number {
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].chapter === chapter) return blocks[i].verseEnd;
    return 0;
}

/**
 * Cut the chain at author tokens. Margin text is attached by line: a
 * "Ver. N" marker sets the verse for the excerpts that follow; anything
 * else is citation for the excerpt whose lines it sits beside.
 */
// A small-capital token later in the line, for the leading-note rule
const SMALL_CAPS_TOKEN = /(?:^|\s)(P[A-Za-z]{4,6}-\s?)?([A-Z][A-Za-z£$01^]{1,}(?:\.?\s?[A-Z][A-Za-z]{1,9})?)[.;:,]/g;

/**
 * A margin note the OCR glued to the start of its line, where the page geometry could not tell it apart: an
 * abbreviated name in mixed case ("Aug.", "Chrys.") that the same author's token in small capitals follows on
 * the line ("Aug. The Evangelist here refutes such a notion. AUG. And how"), or that comes straight after a
 * token closing the previous line ("CHRYS." / "Chrys. That our Lord then"). The edition sets no attribution in
 * mixed case beside one in small capitals.
 */
function marginNoteStripped(t: string, previous: string): string {
    // The OCR may lose the note's period ("Aug Now Jacob's well was there. AUG."); without it only the
    // same author's token later in the line makes the word a note
    const lead = /^([A-Z][a-z]{1,7})(\.)?\s+(?=\S)/.exec(t);
    if (!lead) return t;
    const note = resolveAuthor(lead[1]);
    if (!note) return t;
    const rest = t.slice(lead[0].length);
    let sameLater = false;
    for (const m of rest.matchAll(SMALL_CAPS_TOKEN)) {
        if ((m[2].match(/[A-Z]/g) ?? []).length < 2) continue;
        if (resolveAuthor((m[1] ?? '') + m[2])?.name === note.name) { sameLater = true; break; }
    }
    const afterToken = !!lead[2] && /[A-Z]{2,}[A-Za-z-]*\s?[.;:]$/.test(previous) && !!resolveAuthor(/([A-Za-z-]+)\s?[.;:]$/.exec(previous)![1]);
    return sameLater || afterToken ? rest : t;
}

export function splitChain(chain: { text: string; margin: string; leaf?: number }[], report: CatenaParseReport): CatenaExcerpt[] {
    // Build the running text while remembering the span each line occupies, so a margin note can be given to the excerpt on its line
    let text = '';
    const marginAt: { start: number; end: number; margin: string }[] = [];
    const leafAt: { start: number; leaf: number }[] = [];
    let previous = '';
    for (const line of chain) {
        const t = marginNoteStripped(line.text.trim(), previous);
        previous = t || previous;
        if (!t) continue;
        // A word broken over the line, and an author token broken over it ("THE-" / "OPHYL.", "CHRY-" / "soLOGUS."), rejoin
        const prevWord = text.slice(text.lastIndexOf(' ') + 1);
        // "THE-" / "OPHYL.", "CHRY-" / "soLOGUS.", and in the second batch's mixed case "Am-" / "BRosE;": one token when the join names an author
        const brokenToken = /^[A-Z][A-Za-z£$01^]*-$/.test(prevWord) && /^[A-Za-z£$01^]{2,}[.;,:]/.test(t)
            && ((prevWord.match(/[A-Z]/g) ?? []).length >= 2 || !!resolveAuthor(prevWord.slice(0, -1) + /^[A-Za-z£$01^]+/.exec(t)![0]));
        // A dash before a token ("shepherds- GLOSS.") is the print's, not a break in the word
        const dehyphen = text.endsWith('-') && (/^[a-z]/.test(t) || brokenToken);
        if (dehyphen) text = text.slice(0, -1);
        else if (text) text += ' ';
        const start = text.length;
        leafAt.push({ start, leaf: line.leaf ?? -1 });
        text += t;
        if (line.margin) marginAt.push({ start, end: text.length, margin: line.margin });
    }
    text += ' ';
    // The Mark scan's OCR breaks the prefix itself: "PSEU DO- JEROME;"
    text = text.replace(/(?<=^|\s)PSEU\s?DO[-_]?\s?(?=[A-Z]{2})/g, 'PSEUDO-');
    // A token the OCR broke with a space ("JE ROME.", "BAB ANUS;") is one token when the join names an author
    text = text.replace(/(?<=^|\s)([A-Za-z0-9]{1,8}) ([A-Za-z]{2,})\s?([.;,:])(?=\s)/g, (m, a: string, b: string, mark: string) => ((a + b).replace(/[^A-Z]/g, '').length >= 3 && !resolveAuthor(b) && resolveAuthor(a + b) ? a + b + mark : m));
    // A stray stroke the OCR set before a token ("lORIGEN;", "ICHRYS.", "vPsEUDO-CHRYs.") falls away when the rest names an author
    text = text.replace(/(?<=^|\s)[Il1|vs]([A-Z][A-Za-z-]{2,}[.;,:])(?=\s)/g, (m, rest: string) => (resolveAuthor(rest.slice(0, -1)) ? rest : m));
    // The tail of a margin note the OCR ran into the line ("Aug. de" before "AUG."): a lower-case word of one to
    // three letters between a sentence's end and a token is no word of the text; so is a stray mark the second
    // batch's OCR set before a token ("sin. t BEDE;", "earth. [BeDE;", "judgment. ↑AMBRosE;")
    text = text.replace(/([.;:!?])\s+[a-z]{1,3}\.?\s+(?=[A-Z]{2,}[A-Za-z-]*[.;,:]\s)/g, '$1 ');
    text = text.replace(/(?<=[.;:!?,]\s)[a-z\[\]\u2191\u2020\-]\s?(?=[A-Z][A-Za-z]{2,}[.;,:]\s)/g, (m, offset: number) => (resolveAuthor(/[A-Z][A-Za-z]{2,}/.exec(text.slice(offset + m.length))![0]) ? '' : m));
    // The second batch's OCR loses the period of a small-capital abbreviation at a line's end ("the cock crew. Aug"):
    // these forms are never words, so the mark is restored after a sentence's end
    text = text.replace(/(?<=[.;:!?]\s)(Aug|Chrys|Greg|Orig|Theophyl|Euseb|Athan|Isid|Ambr|Hier|Remig|Raban|Cyr|Pseudo-[A-Z][a-z]+)(?=\s)/g, '$1.');
    const leafOf = (offset: number): number => { let leaf = leafAt[0]?.leaf ?? -1; for (const l of leafAt) { if (l.start <= offset) leaf = l.leaf; else break; } return leaf; };

    const cuts: { start: number; token: string; author: { key: string; name: string } }[] = [];
    for (const m of text.matchAll(TOKEN)) {
        const before = text.slice(Math.max(0, m.index! - 12), m.index!);
        const mention = mentionOf(text, m, before);
        if (mention) {
            if (!mention.endsWith('(mid-sentence)')) report.mentions[mention] = (report.mentions[mention] ?? 0) + 1;
            continue;
        }
        const author = resolveAuthor(m[1], report, before);
        if (!author) { if (isTokenCandidate(m[1])) report.unknownTokens[m[1].toUpperCase()] = (report.unknownTokens[m[1].toUpperCase()] ?? 0) + 1; continue; }
        // Without a mark only an abbreviation in small capitals is a token ("AuG He said"), never a full name
        if (!/[.;,:\u2022]/.test(m[0].slice(m[1].length)) && !(ABBREVIATED.has(author.key) && (m[1].match(/[A-Z]/g) ?? []).length >= 2)) continue;
        cuts.push({ start: m.index! + m[0].indexOf(m[1]), token: m[0].slice(m[0].indexOf(m[1])).trimEnd(), author });
    }

    // A margin note belongs to the last excerpt that begins on or before the note's line
    const owner = (m: { start: number; end: number }): number => {
        let idx = -1;
        for (let i = 0; i < cuts.length; i++) if (cuts[i].start <= m.end) idx = i;
        return idx < 0 ? 0 : idx;
    };
    const notes: { verse?: number; citations: string[] }[] = cuts.map(() => ({ citations: [] }));
    for (const m of marginAt) {
        if (cuts.length === 0) break;
        const target = notes[owner(m)];
        const mark = VERSE_MARK.exec(m.margin);
        if (mark) {
            target.verse = /^\d+$/.test(mark[1]) ? Number(mark[1]) : roman(mark[1]);
            const rest = m.margin.replace(VERSE_MARK, '').trim();
            if (rest) target.citations.push(rest);
        } else {
            target.citations.push(m.margin);
        }
    }

    const excerpts: CatenaExcerpt[] = [];
    let verse: number | undefined;
    let lastAuthor: { key: string; name: string } | undefined;
    for (let i = 0; i < cuts.length; i++) {
        const cut = cuts[i];
        const bodyStart = cut.start + cut.token.length;
        const end = i + 1 < cuts.length ? cuts[i + 1].start : text.length;
        const body = cleanOcr(text.slice(bodyStart, end));
        if (notes[i].verse !== undefined) verse = notes[i].verse;
        const author = cut.author.key === 'ID' && lastAuthor ? lastAuthor : cut.author;
        lastAuthor = author;
        if (!body) continue;
        const citation = cleanOcr(notes[i].citations.join(' '));
        excerpts.push({
            author: author.name,
            token: cut.token,
            ...(citation ? { citation } : {}),
            ...(verse !== undefined ? { verse } : {}),
            text: body,
            leaf: leafOf(cut.start),
        });
    }
    return excerpts;
}

export function emptyReport(): CatenaParseReport {
    return { blocks: 0, excerpts: 0, inferredStarts: [], inferredNumbers: [], unknownTokens: {}, mentions: {}, repairedTokens: {}, uncovered: {} };
}

// ─── Rendering to Codex Commentary Markdown v1 ─────────────

/** Make OCR text safe inside the Markdown subset: nothing in it may open markup. */
export function escapeCommentaryText(text: string): string {
    return text.replace(/[\\*[\]]/g, (c) => `\\${c}`).replace(/^([>#])/gm, '\\$1');
}

const GOSPEL_NAMES: Record<Gospel, string> = { Matt: 'Matthew', Mark: 'Mark', Luke: 'Luke', John: 'John' };

/** Every excerpt of a block in reading order: the chain, then each inner re-quotation's chain. */
export function allExcerpts(block: CatenaBlock): CatenaExcerpt[] {
    return [...block.excerpts, ...block.continuations.flatMap((c) => c.excerpts)];
}

export function blockToEntry(block: CatenaBlock, gospel: Gospel): RawCommentaryEntry {
    const range = block.verseStart === block.verseEnd ? `${block.verseStart}` : `${block.verseStart}-${block.verseEnd}`;
    const paragraphs: string[] = [];
    if (block.lemma) paragraphs.push(`> ${escapeCommentaryText(block.lemma)}`);
    let currentVerse: number | undefined;
    const every = allExcerpts(block);
    const hasMarkers = every.some((e) => e.verse !== undefined && e.verse !== block.verseStart) || block.verseStart !== block.verseEnd;
    const render = (excerpts: CatenaExcerpt[]) => {
        for (const e of excerpts) {
            if (hasMarkers && e.verse !== undefined && e.verse !== currentVerse) {
                currentVerse = e.verse;
                paragraphs.push(`## Verse ${e.verse}`);
            }
            const cite = e.citation ? ` (*${escapeCommentaryText(e.citation)}*)` : '';
            paragraphs.push(`**${escapeCommentaryText(e.author)}.**${cite} ${escapeCommentaryText(e.text)}`);
        }
    };
    render(block.excerpts);
    for (const c of block.continuations) {
        if (c.lemma) paragraphs.push(`> ${escapeCommentaryText(c.lemma)}`);
        render(c.excerpts);
    }
    return {
        id: `catena-${gospel.toLowerCase()}-${block.chapter}-${range}`,
        startRef: `${gospel}.${block.chapter}.${block.verseStart}`,
        endRef: `${gospel}.${block.chapter}.${block.verseEnd}`,
        heading: `${GOSPEL_NAMES[gospel]} ${block.chapter}:${range}`,
        content: paragraphs.join('\n\n'),
        source: block.source,
    };
}
