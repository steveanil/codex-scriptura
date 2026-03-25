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
};

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
