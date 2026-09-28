/**
 * Catena Aurea importer (issue #85): 1841 Oxford scans -> CommentaryEntry.
 *
 * Reads the page-structured OCR (data/texts/catena/<item>_djvu.xml, fetched
 * by fetch-catena.ts and checksum-accepted), parses each scan's lemma
 * blocks, applies the manual corrections recorded against the page
 * image (data/texts/catena/corrections.json), validates every entry and
 * writes data/processed/commentary-catena-aurea.json.
 *
 *   pnpm run import:catena                       whole corpus
 *   pnpm run import:catena -- --chapters Matt.3,Matt.5,John.1   sample only
 *
 * A sample run writes to data/processed/_samples/ so it never ships.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RawCommentaryEntry } from '@codex-scriptura/core';
import { commentaryEntryProblem } from '@codex-scriptura/core';
import { dataDir } from './core/paths.js';
import { parseDjvuPages, type OcrPage } from './importers/djvu-xml.js';
import { parseRapidOcrPages, rapidOcrProblem, type RapidOcrDocument } from './importers/rapidocr-json.js';
import { SOURCE_CHECKSUMS } from './core/source-checksums.js';
import { parseCatenaPages, blockToEntry, allExcerpts, emptyReport, type Gospel, type CatenaParseReport } from './importers/catena-aurea.js';
import { applyCorrections, loadCorrections, loadLineCorrections, type Correction, type LineCorrection } from './importers/catena-corrections.js';

/**
 * The 1841 scans, one per part, in reading order. `chapters` is the range
 * each part OWNS: every chapter belongs to exactly one part, and a block
 * of a chapter found in any other part is refused, so a chapter printed
 * across a part boundary must be assigned here deliberately rather than
 * imported twice. The ranges were read from each part's OCR.
 */
/**
 * Which OCR a scan part is read from. The Archive's own OCR of the first
 * batch of scans is good; of the second batch it is poor enough (author
 * tokens made into words, verse numbers broken) that the pipeline OCRs
 * those parts itself from the checksum-accepted page images, with the
 * pinned environment under ocr/. The choice is made here, per part, and
 * nowhere else.
 */
export type OcrBackend = 'archive' | 'rapidocr';

export type CatenaScan = { item: string; gospel: Gospel; chapters: [number, number]; ocr: OcrBackend };

export const CATENA_SCANS: CatenaScan[] = [
    { item: 'catenaaureacomme00thomuoft', gospel: 'Matt', chapters: [1, 10], ocr: 'archive' },
    { item: 'a6788682p201thomuoft', gospel: 'Matt', chapters: [11, 21], ocr: 'rapidocr' },
    { item: 'catenaaureacomme01thomuoft', gospel: 'Matt', chapters: [22, 28], ocr: 'archive' },
    { item: 'catenaaureacomme02thomuoft', gospel: 'Mark', chapters: [1, 16], ocr: 'archive' },
    { item: 'a6788682p103thomuoft', gospel: 'Luke', chapters: [1, 10], ocr: 'rapidocr' },
    { item: 'p2catenaaureacom03thomuoft', gospel: 'Luke', chapters: [11, 24], ocr: 'rapidocr' },
    { item: 'catenaaureacomme04thomuoft', gospel: 'John', chapters: [1, 10], ocr: 'archive' },
    { item: 'a6788682p204thomuoft', gospel: 'John', chapters: [11, 21], ocr: 'rapidocr' },
];

/** The acquisition artifact of a scan part, relative to data/texts: what fetch:catena downloads and the checksum gate vouches for. */
export function scanSourceFile(scan: CatenaScan): string {
    return scan.ocr === 'archive' ? `${scan.item}_djvu.xml` : `${scan.item}_jp2.zip`;
}

export const scanSourceKey = (scan: CatenaScan): string => `catena/source/${scanSourceFile(scan)}`;

/** Where the generated OCR of a self-read part lives, relative to the texts directory. */
export const scanOcrFile = (scan: CatenaScan): string => `ocr/${scan.item}.rapidocr.json`;

/**
 * A scan part's pages in the one shape the parser reads. An Archive part is
 * its djvu XML; a self-read part is the generated OCR, refused when it was
 * not generated from the accepted bundle.
 */
export function readScanPages(scan: CatenaScan, textsDir: string): OcrPage[] {
    if (scan.ocr === 'archive') {
        const file = path.join(textsDir, 'source', scanSourceFile(scan));
        if (!fs.existsSync(file)) throw new Error(`[catena] Missing ${file} - run fetch:catena`);
        return parseDjvuPages(fs.readFileSync(file, 'utf-8'));
    }
    const file = path.join(textsDir, scanOcrFile(scan));
    if (!fs.existsSync(file)) throw new Error(`[catena] Missing ${file} - run fetch:catena and ocr:catena`);
    const doc = JSON.parse(fs.readFileSync(file, 'utf-8')) as RapidOcrDocument;
    const problem = rapidOcrProblem(doc, scan.item, SOURCE_CHECKSUMS[scanSourceKey(scan)]?.sha256);
    if (problem) throw new Error(`[catena] ${file}: ${problem}`);
    return parseRapidOcrPages(doc);
}

/** Every chapter of every Gospel is owned by exactly one scan; anything else is a map error. */
export function scanMapProblem(scans = CATENA_SCANS): string | null {
    const owners = new Map<string, string>();
    for (const s of scans) for (let c = s.chapters[0]; c <= s.chapters[1]; c++) {
        const key = `${s.gospel}.${c}`;
        const other = owners.get(key);
        if (other) return `${key} is owned by both ${other} and ${s.item}`;
        owners.set(key, s.item);
    }
    return null;
}

/**
 * Ids are unique across the assembled corpus. The only repeat allowed is
 * the edition's own: consecutive blocks of the same scan on the same
 * verse range (John 1:14 is two blocks), which get -2, -3 suffixes in
 * reading order. The same id from two places is a duplicate and refused.
 */
export function assignUniqueIds(entries: Array<RawCommentaryEntry & { item: string }>): void {
    const runs = new Map<string, { item: string; count: number; lastIndex: number }>();
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const base = e.id;
        const run = runs.get(base);
        if (!run) { runs.set(base, { item: e.item, count: 1, lastIndex: i }); continue; }
        if (run.item !== e.item || run.lastIndex !== i - 1) {
            throw new Error(`[catena] duplicate entry ${base}: ${run.item} and ${e.item} both produce it, and they are not consecutive blocks of one scan`);
        }
        run.count += 1;
        run.lastIndex = i;
        // "_2" rather than "-2": a verse range like "3-5" already uses the hyphen
        e.id = `${base}_${run.count}`;
    }
}

const textsDir = path.join(dataDir, 'texts', 'catena');

export function verseCountsFor(gospel: Gospel): Record<number, number> {
    const verses = JSON.parse(fs.readFileSync(path.join(dataDir, 'processed', 'kjv-verses.json'), 'utf-8')) as Array<{ book: string; chapter: number; verse: number; verseEnd?: number }>;
    const counts: Record<number, number> = {};
    for (const v of verses) if (v.book === gospel) counts[v.chapter] = Math.max(counts[v.chapter] ?? 0, v.verseEnd ?? v.verse);
    return counts;
}

export type ImportOptions = {
    chapters?: Set<string>;
    corrections?: Correction[];
    lineCorrections?: LineCorrection[];
    /** Where the scans are read from (source/ and ocr/ beneath it); the default is data/texts/catena. */
    textsDir?: string;
    log?: (line: string) => void;
};

/**
 * Round-trip check: the words of the entry's lemma must be readable on the
 * scanned leaf its locator names, in order. An entry that cannot be traced
 * to its page is refused, because the locator is what the credits, the
 * Church Fathers work and any future dispute rely on.
 */
export function traceableProblem(entry: RawCommentaryEntry, pages: OcrPage[]): string | null {
    if (!entry.source) return `${entry.id}: no source locator`;
    const { leafStart, leafEnd } = entry.source;
    const span = pages.filter((p) => p.leaf >= leafStart && p.leaf <= leafEnd).sort((a, b) => a.leaf - b.leaf);
    if (span.length === 0 || span[0].leaf !== leafStart) return `${entry.id}: leaf ${leafStart} is not in the scan`;
    const lemma = entry.content.split('\n\n')[0].replace(/^>\s*/, '');
    const words = lemma.replace(/\\([\\*[\]])/g, '$1').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
    // Compared without spaces, so a word the OCR broke over a line ("remem- brance") still matches the lemma's joined form
    const text = (p: OcrPage) => p.lines.flatMap((l) => l.words.map((w) => w.text.toLowerCase().replace(/[^a-z0-9]/g, ''))).join('');
    // The lemma opens on leafStart; a long lemma may run on to the next leaf, so the rest is looked for across the block's leaves in order
    const firstPage = text(span[0]);
    if (words.length && firstPage.indexOf(words[0]) < 0) return `${entry.id}: lemma word "${words[0]}" not on leaf ${leafStart}`;
    const joined = span.map(text).join('');
    let at = 0;
    for (const w of words) {
        const i = joined.indexOf(w, at);
        if (i < 0) return `${entry.id}: lemma word "${w}" not on leaves ${leafStart}-${leafEnd}`;
        at = i + w.length;
    }
    return null;
}

/** Where each excerpt of an entry was read, for the page-by-page review queue; written beside the corpus, never shipped. */
export type ReviewIndex = Record<string, { item: string; excerptLeaves: number[] }>;

export function importCatena(opts: ImportOptions = {}): { entries: RawCommentaryEntry[]; report: Record<string, CatenaParseReport>; review: ReviewIndex } {
    const log = opts.log ?? console.log;
    const entries: Array<RawCommentaryEntry & { item: string; excerptLeaves: number[] }> = [];
    const report: Record<string, CatenaParseReport> = {};
    const wanted = opts.chapters;
    const problems: string[] = [];
    const mapProblem = scanMapProblem();
    if (mapProblem) throw new Error(`[catena] scan map: ${mapProblem}`);
    const owns = (scan: (typeof CATENA_SCANS)[number], chapter: string) => chapter.startsWith(`${scan.gospel}.`) && Number(chapter.split('.')[1]) >= scan.chapters[0] && Number(chapter.split('.')[1]) <= scan.chapters[1];
    if (wanted) for (const c of wanted) if (!CATENA_SCANS.some((s) => owns(s, c))) throw new Error(`[catena] no scan owns ${c}`);
    for (const scan of CATENA_SCANS) {
        const inScope = !wanted || [...wanted].some((c) => owns(scan, c));
        if (!inScope) continue;
        // A missing scan that the run needs is an error, never a shorter corpus
        const pages = readScanPages(scan, opts.textsDir ?? textsDir);
        const counts = verseCountsFor(scan.gospel);
        const r = emptyReport();
        const corrections = opts.corrections ?? loadCorrections();
        const lineCorrections = opts.lineCorrections ?? loadLineCorrections();
        const parsed = applyCorrections(parseCatenaPages(pages, scan.item, counts, r, { lineCorrections, firstChapter: scan.chapters[0] }), corrections, scan.item);
        // A part's OCR may carry the neighbouring part's chapter at either end; only the chapters this part owns are its to emit
        const blocks = parsed
            .filter((b) => b.chapter >= scan.chapters[0] && b.chapter <= scan.chapters[1])
            .filter((b) => !wanted || wanted.has(`${scan.gospel}.${b.chapter}`));
        const foreign = parsed.filter((b) => b.chapter < scan.chapters[0] || b.chapter > scan.chapters[1]).map((b) => b.chapter);
        if (foreign.length) log(`[catena] ${scan.item}: ignoring ${foreign.length} block(s) of chapter(s) ${[...new Set(foreign)].join(', ')} owned by another part`);
        report[scan.item] = r;
        for (const b of blocks) {
            const entry = blockToEntry(b, scan.gospel);
            const problem = commentaryEntryProblem(entry) ?? traceableProblem(entry, pages);
            if (problem) problems.push(`${scan.item}: ${problem} (leaves ${b.source.leafStart}-${b.source.leafEnd})`);
            entries.push({ ...entry, item: scan.item, excerptLeaves: allExcerpts(b).map((e) => e.leaf) });
        }
        log(`[catena] ${scan.item} (${scan.gospel} ${scan.chapters[0]}-${scan.chapters[1]}): ${blocks.length} blocks, ${blocks.reduce((n, b) => n + b.excerpts.length, 0)} excerpts, unknown tokens ${Object.keys(r.unknownTokens).length}, repaired ${Object.keys(r.repairedTokens).length}`);
    }
    // Every invalid or untraceable entry is listed at once, so one run shows the whole correction workload
    if (problems.length) throw new Error(`[catena] ${problems.length} entries refused:\n  ${problems.join('\n  ')}`);
    assignUniqueIds(entries);
    const ids = new Set<string>();
    for (const e of entries) {
        if (ids.has(e.id)) throw new Error(`[catena] duplicate entry id after assignment: ${e.id}`);
        ids.add(e.id);
    }
    const review: ReviewIndex = {};
    for (const e of entries) review[e.id] = { item: e.item, excerptLeaves: e.excerptLeaves };
    return { entries: entries.map(({ item: _item, excerptLeaves: _leaves, ...e }) => e), report, review };
}

if (process.argv[1] && process.argv[1].endsWith('import-catena-aurea.ts')) {
    const arg = process.argv.indexOf('--chapters');
    const chapters = arg > 0 ? new Set(process.argv[arg + 1].split(',')) : undefined;
    const { entries, report, review } = importCatena({ chapters });
    const out = chapters
        ? path.join(dataDir, 'processed', '_samples', 'commentary-catena-aurea.sample.json')
        : path.join(dataDir, 'processed', 'commentary-catena-aurea.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(entries), 'utf-8');
    fs.writeFileSync(out.replace(/\.json$/, '.report.json'), JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(out.replace(/\.json$/, '.review-index.json'), JSON.stringify(review), 'utf-8');
    console.log(`[catena] Written: ${out} (${entries.length} entries)`);
}
