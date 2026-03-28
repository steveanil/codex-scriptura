/**
 * Standalone script to add Words-of-Jesus (wj) offset ranges to web-verses.json.
 * Reads the USFX XML source, extracts <wj> ranges for each verse, and patches
 * the existing JSON file in place.
 *
 * Usage: npx tsx src/add-wj-to-web.ts
 */
import fs from 'node:fs';
import path from 'node:path';

// ─── Paths ─────────────────────────────────────────────────
// This script runs from packages/data-pipeline, so ../../data is the repo data dir.
// But for worktree compatibility, also try the main repo location.
const candidates = [
    path.resolve(process.cwd(), '../../data/texts/eng-web.usfx.xml'),
    path.resolve(process.cwd(), '../../../../data/texts/eng-web.usfx.xml'),
    // Direct path fallback
    '/home/steveaj/Projects/codex-scriptura/data/texts/eng-web.usfx.xml',
];
const xmlPath = candidates.find(p => fs.existsSync(p));
if (!xmlPath) {
    console.error('Could not find eng-web.usfx.xml. Tried:', candidates);
    process.exit(1);
}

const jsonCandidates = [
    path.resolve(process.cwd(), '../../data/processed/web-verses.json'),
    path.resolve(process.cwd(), '../../static/data/web-verses.json'),
    '/home/steveaj/Projects/codex-scriptura/data/processed/web-verses.json',
    '/home/steveaj/Projects/codex-scriptura/static/data/web-verses.json',
];
const jsonPath = jsonCandidates.find(p => fs.existsSync(p));
if (!jsonPath) {
    console.error('Could not find web-verses.json. Tried:', jsonCandidates);
    process.exit(1);
}

console.log(`XML source: ${xmlPath}`);
console.log(`JSON file:  ${jsonPath}`);

// ─── USFM → OSIS book ID mapping ──────────────────────────
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
    TOB: 'Tob', JDT: 'Jdt', ESG: 'AddEsth', WIS: 'Wis', SIR: 'Sir',
    BAR: 'Bar', LJE: 'EpJer', S3Y: 'PrAzar', SUS: 'Sus', BEL: 'Bel',
    '1MA': '1Macc', '2MA': '2Macc', '1ES': '1Esd', MAN: 'PrMan',
    PS2: 'AddPs', '3MA': '3Macc', '4MA': '4Macc',
    MAT: 'Matt', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts',
    ROM: 'Rom', '1CO': '1Cor', '2CO': '2Cor', GAL: 'Gal', EPH: 'Eph',
    PHP: 'Phil', COL: 'Col', '1TH': '1Thess', '2TH': '2Thess',
    '1TI': '1Tim', '2TI': '2Tim', TIT: 'Titus', PHM: 'Phlm',
    HEB: 'Heb', JAS: 'Jas', '1PE': '1Pet', '2PE': '2Pet',
    '1JN': '1John', '2JN': '2John', '3JN': '3John', JUD: 'Jude',
    REV: 'Rev',
};

const SKIP_BOOKS = new Set(['FRT', 'INT', 'BAK', 'OTH', 'XXA', 'XXB', 'XXC', 'XXD', 'XXE', 'XXF', 'XXG']);

// ─── extractWjRanges — same as in import-usfx.ts ──────────
function extractWjRanges(rawSlice: string): number[][] {
    const ranges: number[][] = [];
    let tagsReplaced = '';
    let inWjFlags: boolean[] = [];
    let inWj = false;
    let i = 0;

    while (i < rawSlice.length) {
        if (rawSlice.startsWith('<wj>', i) || rawSlice.startsWith('<wj ', i)) {
            const end = rawSlice.indexOf('>', i);
            if (end !== -1) { i = end + 1; } else { i += 4; }
            inWj = true;
        } else if (rawSlice.startsWith('</wj>', i)) {
            inWj = false;
            i += 5;
        } else if (rawSlice[i] === '<') {
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

    // Decode entities
    const entityStrs = ['&amp;', '&lt;', '&gt;', '&apos;', '&quot;'];
    const replacements = ['&', '<', '>', "'", '"'];
    let decoded = '';
    let decodedWjFlags: boolean[] = [];
    let j = 0;
    while (j < tagsReplaced.length) {
        let matched = false;
        for (let e = 0; e < entityStrs.length; e++) {
            if (tagsReplaced.startsWith(entityStrs[e], j)) {
                decoded += replacements[e];
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

    // Collapse whitespace + trim
    let final = '';
    let finalWjFlags: boolean[] = [];
    let prevSpace = true;
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
    if (final.endsWith(' ')) {
        final = final.slice(0, -1);
        finalWjFlags.pop();
    }

    // Extract contiguous ranges
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

// ─── Main ──────────────────────────────────────────────────
const xml = fs.readFileSync(xmlPath, 'utf-8');

// Parse XML to extract per-verse wj ranges
const wjMap = new Map<string, number[][]>(); // osisId → ranges

const tokenRe = /<book\s+id="([^"]+)"|<c\s+id="(\d+)"|<v\s+id="(\d+)"[^/]*\/>|<ve\s*\/>/g;
let currentBook = '';
let currentOsisBook = '';
let currentChapter = 0;
let verseStart = -1;
let verseNum = 0;

let tok: RegExpExecArray | null;
while ((tok = tokenRe.exec(xml)) !== null) {
    if (tok[1] !== undefined) {
        currentBook = tok[1];
        currentOsisBook = USFM_TO_OSIS[currentBook] ?? '';
        currentChapter = 0;
        verseStart = -1;
    } else if (tok[2] !== undefined) {
        currentChapter = parseInt(tok[2], 10);
        verseStart = -1;
    } else if (tok[3] !== undefined) {
        verseNum = parseInt(tok[3], 10);
        verseStart = tok.index + tok[0].length;
    } else if (verseStart !== -1 && tok[0].startsWith('<ve')) {
        if (SKIP_BOOKS.has(currentBook) || !currentOsisBook || currentChapter === 0) {
            verseStart = -1;
            continue;
        }

        const rawSlice = xml.slice(verseStart, tok.index);
        const wjRanges = extractWjRanges(rawSlice);

        if (wjRanges.length > 0) {
            const osisId = `${currentOsisBook}.${currentChapter}.${verseNum}`;
            wjMap.set(osisId, wjRanges);
        }

        verseStart = -1;
    }
}

console.log(`Found wj ranges for ${wjMap.size} verses.`);

// Patch the JSON file
type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    osisId: string;
    text: string;
    lemmas?: string;
    wj?: string;
};

const verses: RawVerse[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
let patchedCount = 0;

for (const v of verses) {
    const ranges = wjMap.get(v.osisId);
    if (ranges) {
        // Validate that ranges don't exceed text length
        const maxEnd = Math.max(...ranges.map(r => r[1]));
        if (maxEnd <= v.text.length) {
            v.wj = JSON.stringify(ranges);
            patchedCount++;
        } else {
            console.warn(`  Skipping ${v.osisId}: range end ${maxEnd} > text length ${v.text.length}`);
        }
    }
}

// Write back (also copy to static/data if it exists)
fs.writeFileSync(jsonPath, JSON.stringify(verses, null, 2), 'utf-8');
console.log(`Patched ${patchedCount} verses with wj data in ${jsonPath}`);

console.log('Done!');
