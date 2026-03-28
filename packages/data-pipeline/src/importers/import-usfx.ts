import fs from 'node:fs';
import path from 'node:path';

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
    osisId: string;
    text: string;
    /** Space-separated Strong's tokens extracted from <w lemma="..."> markup, if present. */
    lemmas?: string;
    /** JSON-encoded array of [start, end] character offset pairs for words of Jesus. */
    wj?: string;
};

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
            // Opening wj tag — skip the tag itself
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

    // Step 2: Decode entities — this can change string length.
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

    // Step 3: Collapse whitespace and trim — matching .replace(/\s+/g, ' ').trim()
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
 * Extract Strong's identifiers from <w lemma="..."> elements in a verse slice.
 * See the OSIS importer for full normalization documentation.
 * Returns empty string when no lemma markup is found (safe for all current sources).
 */
function extractLemmas(rawSlice: string): string {
    const tokens = new Set<string>();
    const wTagRe = /<w\b[^>]*\blemma="([^"]+)"[^>]*/g;
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

    // State machine: track current book and chapter as we scan
    let currentBook = '';
    let currentOsisBook = '';
    let currentChapter = 0;

    // Regex to find structural markers: <book id="...">, <c id="...">, <v id="..."/>, <ve/>
    const tokenRe = /<book\s+id="([^"]+)"|<c\s+id="(\d+)"|<v\s+id="(\d+)"[^/]*\/>|<ve\s*\/>/g;

    let verseStart = -1;
    let verseNum = 0;

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
            // <v id="N"/>  — verse start
            verseNum = parseInt(tok[3], 10);
            verseStart = tok.index + tok[0].length;
        } else if (verseStart !== -1 && tok[0].startsWith('<ve')) {
            // <ve/> — verse end
            if (SKIP_BOOKS.has(currentBook) || !currentOsisBook || currentChapter === 0) {
                verseStart = -1;
                continue;
            }

            const rawSlice = xml.slice(verseStart, tok.index);

            // Extract lemma identifiers BEFORE stripping tags (no-op for current sources).
            const lemmas = extractLemmas(rawSlice);

            // Extract words-of-Jesus ranges BEFORE stripping tags.
            const wjRanges = extractWjRanges(rawSlice);

            // Strip tags, decode entities
            const text = rawSlice
                .replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&apos;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, ' ')
                .trim();

            if (text) {
                const osisId = `${currentOsisBook}.${currentChapter}.${verseNum}`;
                verses.push({
                    translation: translationId,
                    book: currentOsisBook,
                    chapter: currentChapter,
                    verse: verseNum,
                    osisId,
                    text,
                    ...(lemmas ? { lemmas } : {}),
                    ...(wjRanges.length > 0 ? { wj: JSON.stringify(wjRanges) } : {}),
                });
            }

            verseStart = -1;
        }
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(verses, null, 2), 'utf-8');
    console.log(`[${translationId}] Imported ${verses.length} verses to ${outputPath}`);

    if (verses.length > 0) {
        const first = verses[0];
        console.log(`  First: ${first.osisId} — "${first.text.slice(0, 60)}…"`);
        const last = verses[verses.length - 1];
        console.log(`  Last:  ${last.osisId} — "${last.text.slice(0, 60)}…"`);
    }
}
