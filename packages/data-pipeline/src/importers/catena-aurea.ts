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
import { pageLines, type OcrPage, type PageLine } from './djvu-xml.js';

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

export type CatenaBlock = {
    chapter: number;
    verseStart: number;
    verseEnd: number;
    lemma: string;
    excerpts: CatenaExcerpt[];
    source: CommentarySourceLocator;
};

export type CatenaParseReport = {
    blocks: number;
    excerpts: number;
    /** Lemma blocks whose first verse number the OCR lost; the range was inferred from the previous block. */
    inferredStarts: string[];
    /** Upper-case tokens that looked like an author but matched nothing; kept as text. */
    unknownTokens: Record<string, number>;
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
    'CYPRIAN': 'Cyprian', 'EUSEB': 'Eusebius', 'SEVERIAN': 'Severian', 'THEODORET': 'Theodoret',
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
    'CYR': 'Cyril', 'ATHANASIUS': 'Athanasius', 'EUSEBIUS': 'Eusebius', 'MAXIM': 'Maximus', 'DAMASCENE': 'John Damascene', 'DIONYS': 'Dionysius',
    'PSEUDO-DIONYSIUS': 'Pseudo-Dionysius', 'PSEUDO-DIONYS': 'Pseudo-Dionysius', 'GREEK EX': 'Greek Expositor', 'GREEK EXPOSITOR': 'Greek Expositor',
    'TITUS BOST': 'Titus of Bostra', 'ISIDORE PELEUS': 'Isidore of Pelusium', 'ISID. PELEUS': 'Isidore of Pelusium', 'SEVERUS': 'Severus',
    'PROCLUS': 'Proclus', 'ASTERIUS': 'Asterius', 'APOLLINARIS': 'Apollinarius', 'BASIL. SEL': 'Basil of Seleucia', 'GREG. THAUM': 'Gregory Thaumaturgus',
};

// Any upper-case word ending in a period may be an author token; resolveAuthor decides. OCR noise
// before a token ("^rue- REMIG.") is common enough that sentence punctuation cannot be required.
// Small capitals come out of the OCR in upper case, sometimes with lower-case glyphs mixed in
// ("PsEUDO-CiiRYs."), sometimes with a space before the period ("RABANUS ;"). A candidate needs
// at least three capitals; resolveAuthor decides whether it names anyone.
// A second word belongs to the token for the names the edition prints in two parts ("GREG. NYSS.", "GREEK EX.", "TITUS BOST.")
const SECOND = '(?:NAZ|NYSS|EPH|MAG|SYR|MOPS|SEL|THAUM|EX|EXPOSITOR|BOST|PELEUS|Naz|Nyss|Ex|Bost|Peleus|Sel)';
const TOKEN = new RegExp(`(?:^|(?<=\\s))((?:P[sS][eE][uU][dD][oO]-)?[A-Z][A-Za-z£$01^]{1,}(?:\\.?\\s?${SECOND})?)\\s?[.;,]\\s`, 'g');
const AT_START = new RegExp(`^(?:P[sS][eE][uU][dD][oO]-)?[A-Z][A-Za-z£$01^]{1,}(?:\\.?\\s?${SECOND})?\\s?[.;,]\\s`);

/** Glyphs the OCR substitutes inside small capitals: "Au£." for "AUG.", "CHRY$." for "CHRYS.", "0RIGEN." for "ORIGEN." */
function normaliseGlyphs(raw: string): string {
    return raw.toUpperCase().replace(/£/g, 'G').replace(/\$/g, 'S').replace(/0/g, 'O').replace(/1/g, 'I').replace(/\^/g, '');
}

/** Abbreviated author forms never occur as ordinary words, so a mixed-case OCR of them ("Chrys.", "Remig.") is safe to take. */
const ABBREVIATED = new Set(Object.keys(AUTHORS).filter((k) => k.length <= 6 || k.includes('. ') || k.startsWith('PSEUDO-')));
/** Words before a full name that make it a mention in prose ("according to Augustine.") rather than an attribution. */
const MENTION_BEFORE = /(?:^|\s)(?:of|as|by|to|with|from|in|on|says|saith|said|and|or|than|for|St\.|S\.|St|blessed|holy)\s*$/i;

function isTokenCandidate(raw: string, before = ''): boolean {
    const capitals = (raw.match(/[A-Z]/g) ?? []).length;
    if (capitals >= 3) return true;
    const key = normaliseGlyphs(raw);
    // Fewer capitals is acceptable only when the glyph-normalised token is exactly a known author,
    // and either two of them are capitals ("ID.") or a noise glyph shows small capitals were read ("Au£.")
    if ((capitals >= 2 || /[£$01^]/.test(raw)) && key in AUTHORS) return true;
    // Some scans' OCR read the small capitals as ordinary capitalised words ("Chrys.", "Ambrose ;"):
    // an abbreviation is taken outright, a full name only where prose would not put it
    if (capitals === 1 && key in AUTHORS) {
        if (ABBREVIATED.has(key)) return true;
        return !MENTION_BEFORE.test(before);
    }
    return false;
}

/** Offset of the first author token in a line, or -1. */
function firstTokenAt(line: string): number {
    for (const m of (line + ' ').matchAll(TOKEN)) {
        if (resolveAuthor(m[1], undefined, line.slice(Math.max(0, m.index! - 12), m.index!))) return m.index! + m[0].indexOf(m[1]);
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
export function resolveAuthor(raw: string, report?: CatenaParseReport, before = ''): { key: string; name: string } | null {
    if (!isTokenCandidate(raw, before)) return null;
    const token = normaliseGlyphs(raw);
    const key = token.replace(/\.\s?/g, '. ').replace(/\.$/, '').replace(/\. /g, '. ').trim();
    const compact = key.replace(/\.\s/g, '. ');
    if (AUTHORS[compact]) return { key: compact, name: AUTHORS[compact] };
    // "GREG NYSS" / "GREG. NYSS" / "GREEK EX" are one name however the period fell
    const spaced = compact.replace(/\. /g, ' ');
    const dotted = compact.replace(/ (?=[A-Z])/g, '. ');
    for (const variant of [spaced, dotted]) if (AUTHORS[variant]) return { key: variant, name: AUTHORS[variant] };
    if (compact.length < 4) return null;
    // Repairs keep the first letter and allow one wrong glyph per five characters, so "HERE" never becomes "BEDE"
    let best: { key: string; d: number } | undefined;
    for (const known of Object.keys(AUTHORS)) {
        if (known.length < 4 || known[0] !== compact[0] || Math.abs(known.length - compact.length) > 2) continue;
        const d = editDistance(known, compact);
        // One wrong glyph up to six characters, two beyond: "CHRIST" must not become "CHRYS"
        const allowed = compact.length <= 6 ? 1 : 2;
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
const CHAPTER = /^CHA[PR][.,]?\s+([IVXLCivxlcy]{1,7})[.,]?\s*$/;
// The second batch sometimes runs the head into the first lemma line: "Chap. XVI. 1. The Pharisees also with the"
const RUN_IN_CHAPTER = /^Cha[pr][.,]?\s+([IVXLCivxlcy]{1,7})[.,]?\s+(?=\d{1,3}[.,]\s)/i;

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
export function chapterFromHead(numeral: string, previous: number, report?: CatenaParseReport): number | null {
    const cleaned = numeral.toUpperCase().replace(/Y/g, 'V');
    // A scan part may open mid-Gospel: its first head is taken as printed
    if (previous === 0) return /^[IVXLC]+$/.test(cleaned) && roman(cleaned) >= 1 && roman(cleaned) <= 150 ? roman(cleaned) : null;
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
const LEMMA_LINE = /^(?:Ver\.\s*)?(\d{1,3})(?:\s*[-\u2013\u2014]\s*(\d{1,3}))?[.,]\s+(.*)$/i;
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
export function parseCatenaPages(pages: OcrPage[], item: string, verseCounts: Record<number, number>, report: CatenaParseReport = emptyReport()): CatenaBlock[] {
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
        blocks.push(b);
        open = null;
    };

    for (const page of pages) {
        const { lines, printedPage: read } = pageLines(page);
        if (read && /^\d+$/.test(read)) lastPrinted = { page: Number(read), leaf: page.leaf };
        const printedPage = read ?? (lastPrinted ? String(lastPrinted.page + (page.leaf - lastPrinted.leaf)) : undefined);
        for (const line of lines) {
            let main = line.main.trim();
            if (!main) continue;
            const chap = CHAPTER.exec(main);
            if (chap) {
                const next = chapterFromHead(chap[1], chapter, report);
                if (next !== null) { close(); chapter = next; continue; }
            }
            const runIn = RUN_IN_CHAPTER.exec(main);
            if (runIn) {
                const next = chapterFromHead(runIn[1], chapter, report);
                if (next !== null) { close(); chapter = next; main = main.slice(runIn[0].length); }
            }
            if (chapter === 0) continue;

            const maxVerse = verseCounts[chapter] ?? 200;
            const numbered = LEMMA_LINE.exec(main);
            const number = numbered && Number(numbered[1]) >= 1 && Number(numbered[1]) <= maxVerse ? Number(numbered[1]) : undefined;
            const numberEnd = numbered?.[2] && Number(numbered[2]) >= (number ?? 0) && Number(numbered[2]) <= maxVerse ? Number(numbered[2]) : number;
            const tokenAt = firstTokenAt(main);
            const opensAuthor = tokenAt === 0;
            const indented = line.indent >= LEMMA_INDENT;
            // An unnumbered indented line in larger type opens a further lemma block on the same verse
            // (the edition splits a long verse into parts, each with its own chain)
            // Not a sub-verse lemma: a continuation of a word the previous line broke ("remembr-" / "ence they might"),
            // or a line whose type is not clearly larger than the body
            const lastChain: string = open && !open.inLemma && open.chain.length ? open.chain[open.chain.length - 1].text : '';
            // A sub-verse lemma follows a finished excerpt, so the chain's last line ends a sentence; and the chain's
            // own re-quotation of the next verse ("It follows, Came Mary Magdalen, &c.") is set in lemma type but is chain
            const subVerse: boolean = indented && number === undefined && tokenAt < 0 && open !== null && !open.inLemma
                && line.height >= bodyHeight(page) * 1.15 && main.split(' ').length >= 4 && /[.!?;:)'"\u201d\u2019]\s*$/.test(lastChain)
                && !/^(?:And |Then |Hence |Whence |Wherefore |There |Now |But )?(?:it |there )?follow(?:s|eth)\b/i.test(main);

            if ((number !== undefined && indented && !opensAuthor) || subVerse) {
                const continues = open?.inLemma && number !== undefined && number > open.block.verseEnd && number <= Math.max(...open.numbers, 0) + 3;
                if (!continues) {
                    const previousEnd: number = open ? open.block.verseEnd : lastVerseEnd(blocks, chapter);
                    close();
                    open = {
                        block: { chapter, verseStart: 0, verseEnd: 0, lemma: '', excerpts: [], source: { item, leafStart: page.leaf, leafEnd: page.leaf, ...(printedPage ? { pageStart: printedPage, pageEnd: printedPage } : {}) } },
                        lemmaLines: [], numbers: subVerse ? [previousEnd] : [], chain: [], inLemma: true,
                    };
                    if (subVerse) open.block.verseEnd = previousEnd;
                }
                if (number !== undefined) { open!.numbers.push(number, numberEnd!); open!.block.verseEnd = Math.max(open!.block.verseEnd, numberEnd!); }
                open!.lemmaLines.push(number !== undefined ? numbered![3] : main);
                continue;
            }
            if (!open) continue;
            open.block.source.leafEnd = page.leaf;
            if (printedPage) open.block.source.pageEnd = printedPage;
            if (open.inLemma) {
                if (tokenAt < 0) { open.lemmaLines.push(main); continue; }
                // The chain begins mid-line: the words before the first token still belong to the lemma
                if (tokenAt > 0) open.lemmaLines.push(main.slice(0, tokenAt).trim());
                open.inLemma = false;
                open.chain.push({ text: main.slice(tokenAt), margin: line.margin.trim(), leaf: page.leaf });
                continue;
            }
            open.chain.push({ text: main, margin: line.margin.trim(), leaf: page.leaf });
        }
    }
    close();
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
export function splitChain(chain: { text: string; margin: string; leaf?: number }[], report: CatenaParseReport): CatenaExcerpt[] {
    // Build the running text while remembering the span each line occupies, so a margin note can be given to the excerpt on its line
    let text = '';
    const marginAt: { start: number; end: number; margin: string }[] = [];
    const leafAt: { start: number; leaf: number }[] = [];
    for (const line of chain) {
        const t = line.text.trim();
        if (!t) continue;
        // A word broken over the line, and an author token broken over it ("THE-" / "OPHYL.", "CHRY-" / "soLOGUS."), rejoin
        const prevWord = text.slice(text.lastIndexOf(' ') + 1);
        const brokenToken = /^[A-Z][A-Za-z£$01^]*-$/.test(prevWord) && (prevWord.match(/[A-Z]/g) ?? []).length >= 2 && /^[A-Za-z£$01^]{2,}[.;,]/.test(t);
        const dehyphen = text.endsWith('-') && (/^[a-z]/.test(t) || /^[A-Z]{2,}[.;,]/.test(t) || brokenToken);
        if (dehyphen) text = text.slice(0, -1);
        else if (text) text += ' ';
        const start = text.length;
        leafAt.push({ start, leaf: line.leaf ?? -1 });
        text += t;
        if (line.margin) marginAt.push({ start, end: text.length, margin: line.margin });
    }
    text += ' ';
    const leafOf = (offset: number): number => { let leaf = leafAt[0]?.leaf ?? -1; for (const l of leafAt) { if (l.start <= offset) leaf = l.leaf; else break; } return leaf; };

    const cuts: { start: number; token: string; author: { key: string; name: string } }[] = [];
    for (const m of text.matchAll(TOKEN)) {
        const before = text.slice(Math.max(0, m.index! - 12), m.index!);
        // A mixed-case full name is an attribution only at a sentence boundary
        const mixed = (m[1].match(/[A-Z]/g) ?? []).length === 1;
        if (mixed && m.index! > 0 && !/[.;:?!]\s*$/.test(before)) continue;
        const author = resolveAuthor(m[1], report, before);
        if (!author) { if (isTokenCandidate(m[1])) report.unknownTokens[m[1].toUpperCase()] = (report.unknownTokens[m[1].toUpperCase()] ?? 0) + 1; continue; }
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
    return { blocks: 0, excerpts: 0, inferredStarts: [], unknownTokens: {}, repairedTokens: {}, uncovered: {} };
}

// ─── Rendering to Codex Commentary Markdown v1 ─────────────

/** Make OCR text safe inside the Markdown subset: nothing in it may open markup. */
export function escapeCommentaryText(text: string): string {
    return text.replace(/[\\*[\]]/g, (c) => `\\${c}`).replace(/^([>#])/gm, '\\$1');
}

const GOSPEL_NAMES: Record<Gospel, string> = { Matt: 'Matthew', Mark: 'Mark', Luke: 'Luke', John: 'John' };

export function blockToEntry(block: CatenaBlock, gospel: Gospel): RawCommentaryEntry {
    const range = block.verseStart === block.verseEnd ? `${block.verseStart}` : `${block.verseStart}-${block.verseEnd}`;
    const paragraphs: string[] = [];
    if (block.lemma) paragraphs.push(`> ${escapeCommentaryText(block.lemma)}`);
    let currentVerse: number | undefined;
    const hasMarkers = block.excerpts.some((e) => e.verse !== undefined && e.verse !== block.verseStart) || block.verseStart !== block.verseEnd;
    for (const e of block.excerpts) {
        if (hasMarkers && e.verse !== undefined && e.verse !== currentVerse) {
            currentVerse = e.verse;
            paragraphs.push(`## Verse ${e.verse}`);
        }
        const cite = e.citation ? ` (*${escapeCommentaryText(e.citation)}*)` : '';
        paragraphs.push(`**${escapeCommentaryText(e.author)}.**${cite} ${escapeCommentaryText(e.text)}`);
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
