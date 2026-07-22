import fs from 'node:fs';
import path from 'node:path';
import { recordImportRun } from '../core/import-runs.js';
import { removeElements } from '../core/xml.js';

/**
 * USFX (Unified Standard Format XML) importer.
 *
 * USFX structure:
 *   <book id="GEN"> ... <c id="1"/> ... <v id="1"/>...text...<ve/> ...
 *
 * Book IDs are USFM codes (GEN, EXO, etc.) which must be mapped to OSIS IDs.
 */

type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    /** Last verse of a bridged entry (<v id="15-16"/>); `verse` is the first. */
    verseEnd?: number;
    osisId: string;
    text: string;
    /** Space-separated Strong's tokens extracted from <w lemma="..."> markup, if present. */
    lemmas?: string;
    /** JSON-encoded [start, end, "H7225"] word-alignment spans into `text`, if present. */
    align?: string;
    /** JSON-encoded array of [start, end] character offset pairs for words of Jesus. */
    wj?: string;
};

/**
 * USFX note elements whose CONTENT must be removed before text extraction:
 * <f> footnotes, <fe> endnotes, <x> cross-reference notes. Stripping only
 * the tags (as the generic pass does) would leak translator notes into
 * scripture text - e.g. WEB Gen 1:1 gained "The Hebrew word rendered
 * "God" is …" from its footnote.
 */
const NOTE_TAGS = ['f', 'fe', 'x'];

/**
 * Extract character offset ranges for <wj>...</wj> (words of Jesus) from
 * a raw XML verse slice. The offsets correspond to the final plain-text
 * produced by the same pipeline: strip tags → decode entities → collapse whitespace → trim.
 *
 * Returns an empty array when no <wj> tags are present.
 */
function extractWjRanges(rawSlice: string): number[][] {
    // Step 1: Replace all XML tags with spaces, but track which characters were inside <wj>
    // We build a parallel array: for each char in "tags-replaced" string, is it inside wj?
    const ranges: number[][] = [];
    let tagsReplaced = '';
    let inWjFlags: boolean[] = [];
    let inWj = false;
    let i = 0;

    while (i < rawSlice.length) {
        if (rawSlice.startsWith('<wj>', i) || rawSlice.startsWith('<wj ', i)) {
            // Opening wj tag - skip the tag itself
            const end = rawSlice.indexOf('>', i);
            if (end !== -1) {
                i = end + 1;
            } else {
                i += 4;
            }
            inWj = true;
        } else if (rawSlice.startsWith('</wj>', i)) {
            inWj = false;
            i += 5;
        } else if (rawSlice.startsWith('<w ', i) || rawSlice.startsWith('<w>', i) || rawSlice.startsWith('</w>', i)) {
            // <w> word wrappers are removed with NO replacement - must
            // mirror the main pipeline's `.replace(/<\/?w\b[^>]*>/g, '')`
            // exactly or wj offsets drift on sources with both markups.
            const end = rawSlice.indexOf('>', i);
            i = end !== -1 ? end + 1 : i + 1;
        } else if (rawSlice[i] === '<') {
            // Other tags: replace with space (matching the main pipeline's /<[^>]+>/g → ' ')
            const end = rawSlice.indexOf('>', i);
            if (end !== -1) {
                tagsReplaced += ' ';
                inWjFlags.push(inWj);
                i = end + 1;
            } else {
                tagsReplaced += rawSlice[i];
                inWjFlags.push(inWj);
                i++;
            }
        } else {
            tagsReplaced += rawSlice[i];
            inWjFlags.push(inWj);
            i++;
        }
    }

    // Step 2: Decode entities - this can change string length.
    // We need to map from decoded positions back to wj flags.
    const entityStrs = ['&amp;', '&lt;', '&gt;', '&apos;', '&quot;'];
    const entityReplacements = ['&', '<', '>', "'", '"'];

    let decoded = '';
    let decodedWjFlags: boolean[] = [];
    let j = 0;
    while (j < tagsReplaced.length) {
        let matched = false;
        for (let e = 0; e < entityStrs.length; e++) {
            if (tagsReplaced.startsWith(entityStrs[e], j)) {
                decoded += entityReplacements[e];
                decodedWjFlags.push(inWjFlags[j]);
                j += entityStrs[e].length;
                matched = true;
                break;
            }
        }
        if (!matched) {
            decoded += tagsReplaced[j];
            decodedWjFlags.push(inWjFlags[j]);
            j++;
        }
    }

    // Step 3: Collapse whitespace and trim - matching .replace(/\s+/g, ' ').trim()
    let final = '';
    let finalWjFlags: boolean[] = [];
    let prevSpace = true; // start true to trim leading whitespace
    for (let k = 0; k < decoded.length; k++) {
        if (/\s/.test(decoded[k])) {
            if (!prevSpace) {
                final += ' ';
                finalWjFlags.push(decodedWjFlags[k]);
                prevSpace = true;
            }
        } else {
            final += decoded[k];
            finalWjFlags.push(decodedWjFlags[k]);
            prevSpace = false;
        }
    }
    // Trim trailing space
    if (final.endsWith(' ')) {
        final = final.slice(0, -1);
        finalWjFlags.pop();
    }

    // Step 4: Extract contiguous wj ranges from the flags
    let wjStart = -1;
    for (let k = 0; k <= finalWjFlags.length; k++) {
        const isWj = k < finalWjFlags.length && finalWjFlags[k];
        if (isWj && wjStart === -1) {
            wjStart = k;
        } else if (!isWj && wjStart !== -1) {
            ranges.push([wjStart, k]);
            wjStart = -1;
        }
    }

    return ranges;
}

/**
 * Extract Strong's identifiers from <w> elements in a verse slice.
 * Two attribute forms exist in the wild:
 *   - lemma="strong:H7225" (OSIS-style; see the OSIS importer)
 *   - s="H7225" (eBible.org USFX - ASV, BSB, DBY carry these)
 * Returns empty string when no lemma markup is found.
 */
function extractLemmas(rawSlice: string): string {
    const tokens = new Set<string>();
    const wTagRe = /<w\b[^>]*?\b(?:lemma|s)="([^"]+)"[^>]*/g;
    let m: RegExpExecArray | null;
    while ((m = wTagRe.exec(rawSlice)) !== null) {
        for (const raw of m[1].split(/\s+/)) {
            const token = raw
                .replace(/^strong:/i, '')
                .replace(/^lemma\./i, '')
                .trim()
                .toUpperCase();
            if (/^[HG]\d+[A-Z]?$/.test(token)) {
                tokens.add(token);
            }
        }
    }
    return Array.from(tokens).join(' ');
}

/** [start, end, space-separated Strong's IDs] - char range of the final verse text. */
type AlignSpan = [number, number, string];

/**
 * Normalize one lemma/s-attribute token to canonical Strong's form (H7225/G26),
 * or return null when it isn't one. Same rules as extractLemmas above, plus
 * zero-padding normalization (harmless for eBible sources, which don't pad).
 */
function normalizeStrongsToken(raw: string): string | null {
    const token = raw
        .replace(/^strong:/i, '')
        .replace(/^lemma\./i, '')
        .trim()
        .toUpperCase()
        .replace(/^([HG])0+(?=\d)/, '$1');
    return /^[HG]\d+[A-Z]?$/.test(token) ? token : null;
}

const ENTITIES: Array<[string, string]> = [
    ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&apos;', "'"], ['&quot;', '"'],
];

/**
 * Single-pass walk of a raw USFX verse slice producing the final plain text
 * AND word-alignment spans: which [start, end) ranges of that text came from
 * which <w s="…"> (or lemma="…") element.
 *
 * Mirrors the regex text chain in importUsfx exactly (<w> stripped with no
 * replacement, all other tags become spaces, entities decoded, whitespace
 * collapsed, trimmed). The caller verifies the walk's text against the regex
 * chain's and drops alignment on any drift, so a walk bug can only lose
 * alignment, never corrupt text or misattach a Strong's number.
 */
function extractTextAndAlignment(rawSlice: string): { text: string; align: AlignSpan[] } {
    let out = '';
    const lem: string[] = [];
    const wStack: string[] = [];

    const push = (ch: string) => {
        out += ch;
        lem.push(wStack.length > 0 ? wStack[wStack.length - 1] : '');
    };

    let i = 0;
    while (i < rawSlice.length) {
        if (rawSlice[i] === '<') {
            const end = rawSlice.indexOf('>', i);
            if (end === -1) { push(rawSlice[i]); i++; continue; }
            const tag = rawSlice.slice(i + 1, end);
            const selfClosing = tag.endsWith('/');
            if (/^w\b/.test(tag)) {
                if (!selfClosing) {
                    const attr = /\b(?:lemma|s)="([^"]*)"/.exec(tag);
                    const tokens = (attr?.[1] ?? '').split(/\s+/)
                        .map(normalizeStrongsToken)
                        .filter((t): t is string => t !== null);
                    wStack.push(tokens.join(' '));
                }
            } else if (/^\/w\s*$/.test(tag)) {
                wStack.pop();
            } else {
                // all other tags become a space (mirrors /<[^>]+>/g → ' ')
                out += ' ';
                lem.push(wStack.length > 0 ? wStack[wStack.length - 1] : '');
            }
            i = end + 1;
        } else {
            let matched = false;
            for (const [entity, replacement] of ENTITIES) {
                if (rawSlice.startsWith(entity, i)) {
                    push(replacement);
                    i += entity.length;
                    matched = true;
                    break;
                }
            }
            if (!matched) { push(rawSlice[i]); i++; }
        }
    }

    // Collapse whitespace and trim, carrying the parallel lemma flags.
    let text = '';
    const flags: string[] = [];
    let prevSpace = true;
    for (let k = 0; k < out.length; k++) {
        if (/\s/.test(out[k])) {
            if (!prevSpace) { text += ' '; flags.push(lem[k]); prevSpace = true; }
        } else {
            text += out[k];
            flags.push(lem[k]);
            prevSpace = false;
        }
    }
    if (text.endsWith(' ')) { text = text.slice(0, -1); flags.pop(); }

    // Contiguous runs of the same lemma value become spans; spaces at run
    // edges are shaved off so surfaces slice cleanly.
    const align: AlignSpan[] = [];
    let runStart = -1;
    let runLem = '';
    const pushRun = (endExclusive: number) => {
        let s = runStart, e = endExclusive;
        while (s < e && text[s] === ' ') s++;
        while (e > s && text[e - 1] === ' ') e--;
        if (e > s) align.push([s, e, runLem]);
    };
    for (let k = 0; k <= flags.length; k++) {
        const f = k < flags.length ? flags[k] : '';
        if (f !== runLem) {
            if (runLem) pushRun(k);
            runStart = k;
            runLem = f;
        }
    }

    return { text, align };
}

// USFM → OSIS book ID mapping
const USFM_TO_OSIS: Record<string, string> = {
    GEN: 'Gen', EXO: 'Exod', LEV: 'Lev', NUM: 'Num', DEU: 'Deut',
    JOS: 'Josh', JDG: 'Judg', RUT: 'Ruth',
    '1SA': '1Sam', '2SA': '2Sam', '1KI': '1Kgs', '2KI': '2Kgs',
    '1CH': '1Chr', '2CH': '2Chr', EZR: 'Ezra', NEH: 'Neh', EST: 'Esth',
    JOB: 'Job', PSA: 'Ps', PRO: 'Prov', ECC: 'Eccl', SNG: 'Song',
    ISA: 'Isa', JER: 'Jer', LAM: 'Lam', EZK: 'Ezek', DAN: 'Dan',
    HOS: 'Hos', JOL: 'Joel', AMO: 'Amos', OBA: 'Obad', JON: 'Jonah',
    MIC: 'Mic', NAM: 'Nah', HAB: 'Hab', ZEP: 'Zeph', HAG: 'Hag',
    ZEC: 'Zech', MAL: 'Mal',
    // Apocrypha
    TOB: 'Tob', JDT: 'Jdt', ESG: 'AddEsth', WIS: 'Wis', SIR: 'Sir',
    BAR: 'Bar', LJE: 'EpJer', S3Y: 'PrAzar', SUS: 'Sus', BEL: 'Bel',
    '1MA': '1Macc', '2MA': '2Macc', '1ES': '1Esd', MAN: 'PrMan',
    PS2: 'AddPs', '3MA': '3Macc', '4MA': '4Macc',
    // NT
    MAT: 'Matt', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts',
    ROM: 'Rom', '1CO': '1Cor', '2CO': '2Cor', GAL: 'Gal', EPH: 'Eph',
    PHP: 'Phil', COL: 'Col', '1TH': '1Thess', '2TH': '2Thess',
    '1TI': '1Tim', '2TI': '2Tim', TIT: 'Titus', PHM: 'Phlm',
    HEB: 'Heb', JAS: 'Jas', '1PE': '1Pet', '2PE': '2Pet',
    '1JN': '1John', '2JN': '2John', '3JN': '3John', JUD: 'Jude',
    REV: 'Rev',
};

// Books to skip (front/back matter)
const SKIP_BOOKS = new Set(['FRT', 'INT', 'BAK', 'OTH', 'XXA', 'XXB', 'XXC', 'XXD', 'XXE', 'XXF', 'XXG']);

export function importUsfx(
    xmlPath: string,
    translationId: string,
    outputPath: string
): void {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const verses: RawVerse[] = [];
    let alignMismatches = 0;

    // State machine: track current book and chapter as we scan
    let currentBook = '';
    let currentOsisBook = '';
    let currentChapter = 0;

    // Regex to find structural markers: <book id="...">, <c id="...">, <v id="..."/>, <ve/>
    // <v id> may be a single verse ("15"), a bridge ("15-16") - bridged
    // entries carry the combined text under the first verse number - or a
    // lettered segment ("15a"); segments of the same verse are merged into
    // one record below.
    const tokenRe = /<book\s+id="([^"]+)"|<c\s+id="(\d+)"|<v\s+id="(\d+)[a-zA-Z]?(?:-(\d+)[a-zA-Z]?)?"[^/]*\/>|<ve\s*\/>/g;

    let verseStart = -1;
    let verseNum = 0;
    let verseEndNum: number | undefined;

    let tok: RegExpExecArray | null;
    while ((tok = tokenRe.exec(xml)) !== null) {
        if (tok[1] !== undefined) {
            // <book id="...">
            currentBook = tok[1];
            currentOsisBook = USFM_TO_OSIS[currentBook] ?? '';
            currentChapter = 0;
            verseStart = -1;
        } else if (tok[2] !== undefined) {
            // <c id="N">
            currentChapter = parseInt(tok[2], 10);
            verseStart = -1;
        } else if (tok[3] !== undefined) {
            // <v id="N"/> or <v id="N-M"/> - verse start
            verseNum = parseInt(tok[3], 10);
            verseEndNum = tok[4] !== undefined ? parseInt(tok[4], 10) : undefined;
            if (verseEndNum !== undefined && verseEndNum <= verseNum) verseEndNum = undefined;
            verseStart = tok.index + tok[0].length;
        } else if (verseStart !== -1 && tok[0].startsWith('<ve')) {
            // <ve/> - verse end
            if (SKIP_BOOKS.has(currentBook) || !currentOsisBook || currentChapter === 0) {
                verseStart = -1;
                continue;
            }

            // Remove note elements (with their content) FIRST so footnote
            // text never reaches lemma extraction, wj offsets, or verse text.
            const rawSlice = removeElements(xml.slice(verseStart, tok.index), NOTE_TAGS);

            // Extract lemma identifiers BEFORE stripping tags (no-op for current sources).
            const lemmas = extractLemmas(rawSlice);

            // Extract words-of-Jesus ranges BEFORE stripping tags.
            const wjRanges = extractWjRanges(rawSlice);

            // Strip tags, decode entities. <w> word wrappers are removed
            // with no replacement: the source has real spaces between
            // words, and replacing `</w>` with a space would detach
            // punctuation ("earth ." instead of "earth."). All other tags
            // become a space as before.
            const text = rawSlice
                .replace(/<\/?w\b[^>]*>/g, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&apos;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, ' ')
                .trim();

            if (text) {
                // Word-alignment spans from the mirror walk, verified against
                // the regex chain's text. On drift the alignment is dropped
                // (verse-level lemmas above are unaffected).
                let alignSpans: AlignSpan[] = [];
                if (lemmas) {
                    const walked = extractTextAndAlignment(rawSlice);
                    if (walked.text === text) {
                        alignSpans = walked.align;
                    } else {
                        alignMismatches++;
                    }
                }

                const osisId = `${currentOsisBook}.${currentChapter}.${verseNum}`;
                const prev = verses[verses.length - 1];
                if (prev && prev.osisId === osisId) {
                    // Lettered segments (<v id="15a"/>, <v id="15b"/>) share a
                    // verse number: append to the existing record instead of
                    // emitting a duplicate.
                    const offset = prev.text.length + 1;
                    prev.text += ' ' + text;
                    if (lemmas) {
                        prev.lemmas = prev.lemmas
                            ? Array.from(new Set(`${prev.lemmas} ${lemmas}`.split(' '))).join(' ')
                            : lemmas;
                    }
                    if (alignSpans.length > 0) {
                        const merged: AlignSpan[] = prev.align ? JSON.parse(prev.align) : [];
                        for (const [s, e, l] of alignSpans) merged.push([s + offset, e + offset, l]);
                        prev.align = JSON.stringify(merged);
                    }
                    if (wjRanges.length > 0) {
                        const merged: number[][] = prev.wj ? JSON.parse(prev.wj) : [];
                        for (const [s, e] of wjRanges) merged.push([s + offset, e + offset]);
                        prev.wj = JSON.stringify(merged);
                    }
                    if (verseEndNum !== undefined) {
                        prev.verseEnd = Math.max(prev.verseEnd ?? verseNum, verseEndNum);
                    }
                } else {
                    verses.push({
                        translation: translationId,
                        book: currentOsisBook,
                        chapter: currentChapter,
                        verse: verseNum,
                        ...(verseEndNum !== undefined ? { verseEnd: verseEndNum } : {}),
                        osisId,
                        text,
                        ...(lemmas ? { lemmas } : {}),
                        ...(alignSpans.length > 0 ? { align: JSON.stringify(alignSpans) } : {}),
                        ...(wjRanges.length > 0 ? { wj: JSON.stringify(wjRanges) } : {}),
                    });
                }
            }

            verseStart = -1;
        }
    }

    if (alignMismatches > 0) {
        console.warn(`[${translationId}] Alignment walk diverged from text chain in ${alignMismatches} verses - alignment dropped there (lemmas kept).`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(verses), 'utf-8');
    recordImportRun(path.join(path.dirname(outputPath), '_metadata'), {
        sourceIds: [`${translationId.toLowerCase()}-text`],
        inputFiles: [xmlPath],
        stats: { created: verses.length, updated: 0, skipped: 0, conflicts: 0 },
    });
    console.log(`[${translationId}] Imported ${verses.length} verses to ${outputPath}`);

    if (verses.length > 0) {
        const first = verses[0];
        console.log(`  First: ${first.osisId} - "${first.text.slice(0, 60)}…"`);
        const last = verses[verses.length - 1];
        console.log(`  Last:  ${last.osisId} - "${last.text.slice(0, 60)}…"`);
    }
}
