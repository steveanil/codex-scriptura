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
import { parseCatenaPages, blockToEntry, emptyReport, type Gospel, type CatenaParseReport } from './importers/catena-aurea.js';
import { applyCorrections, loadCorrections, type Correction } from './importers/catena-corrections.js';

/** The 1841 scans, one per part, in reading order; chapters are the range each part holds. */
export const CATENA_SCANS: Array<{ item: string; gospel: Gospel; chapters: [number, number] }> = [
    { item: 'catenaaureacomme00thomuoft', gospel: 'Matt', chapters: [1, 10] },
    { item: 'a6788682p201thomuoft', gospel: 'Matt', chapters: [10, 21] },
    { item: 'catenaaureacomme01thomuoft', gospel: 'Matt', chapters: [22, 28] },
    { item: 'catenaaureacomme02thomuoft', gospel: 'Mark', chapters: [1, 16] },
    { item: 'a6788682p103thomuoft', gospel: 'Luke', chapters: [1, 10] },
    { item: 'p2catenaaureacom03thomuoft', gospel: 'Luke', chapters: [11, 24] },
    { item: 'catenaaureacomme04thomuoft', gospel: 'John', chapters: [1, 10] },
    { item: 'a6788682p204thomuoft', gospel: 'John', chapters: [10, 21] },
];

const textsDir = path.join(dataDir, 'texts', 'catena');

function verseCountsFor(gospel: Gospel): Record<number, number> {
    const verses = JSON.parse(fs.readFileSync(path.join(dataDir, 'processed', 'kjv-verses.json'), 'utf-8')) as Array<{ book: string; chapter: number; verse: number; verseEnd?: number }>;
    const counts: Record<number, number> = {};
    for (const v of verses) if (v.book === gospel) counts[v.chapter] = Math.max(counts[v.chapter] ?? 0, v.verseEnd ?? v.verse);
    return counts;
}

export type ImportOptions = { chapters?: Set<string>; corrections?: Correction[]; log?: (line: string) => void };

/**
 * Round-trip check: the words of the entry's lemma must be readable on the
 * scanned leaf its locator names, in order. An entry that cannot be traced
 * to its page is refused, because the locator is what the credits, the
 * Church Fathers work and any future dispute rely on.
 */
export function traceableProblem(entry: RawCommentaryEntry, pages: OcrPage[]): string | null {
    if (!entry.source) return `${entry.id}: no source locator`;
    const page = pages.find((p) => p.leaf === entry.source!.leafStart);
    if (!page) return `${entry.id}: leaf ${entry.source.leafStart} is not in the scan`;
    const lemma = entry.content.split('\n\n')[0].replace(/^>\s*/, '');
    const words = lemma.replace(/\\([\\*[\]])/g, '$1').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
    const pageText = page.lines.flatMap((l) => l.words.map((w) => w.text.toLowerCase().replace(/[^a-z0-9]/g, ''))).join(' ');
    let at = 0;
    for (const w of words) {
        const i = pageText.indexOf(w, at);
        if (i < 0) return `${entry.id}: lemma word "${w}" not on leaf ${entry.source.leafStart}`;
        at = i + w.length;
    }
    return null;
}

export function importCatena(opts: ImportOptions = {}): { entries: RawCommentaryEntry[]; report: Record<string, CatenaParseReport> } {
    const log = opts.log ?? console.log;
    const entries: RawCommentaryEntry[] = [];
    const report: Record<string, CatenaParseReport> = {};
    const wanted = opts.chapters;
    for (const scan of CATENA_SCANS) {
        const inScope = !wanted || [...wanted].some((c) => c.startsWith(`${scan.gospel}.`) && Number(c.split('.')[1]) >= scan.chapters[0] && Number(c.split('.')[1]) <= scan.chapters[1]);
        if (!inScope) continue;
        const file = path.join(textsDir, `${scan.item}_djvu.xml`);
        if (!fs.existsSync(file)) { log(`[catena] Missing ${file} - run fetch:catena`); continue; }
        const pages = parseDjvuPages(fs.readFileSync(file, 'utf-8'));
        const counts = verseCountsFor(scan.gospel);
        const r = emptyReport();
        const corrections = opts.corrections ?? loadCorrections();
        const blocks = applyCorrections(parseCatenaPages(pages, scan.item, counts, r), corrections, scan.item)
            // A part's OCR may carry the neighbouring part's chapter at either end; keep only the chapters it is the source for
            .filter((b) => b.chapter >= scan.chapters[0] && b.chapter <= scan.chapters[1])
            .filter((b) => !wanted || wanted.has(`${scan.gospel}.${b.chapter}`));
        report[scan.item] = r;
        const seen = new Map<string, number>();
        for (const b of blocks) {
            const entry = blockToEntry(b, scan.gospel);
            // The edition sometimes splits one verse over two lemma blocks (John 1:14); ids stay unique per resource
            const n = (seen.get(entry.id) ?? 0) + 1;
            seen.set(entry.id, n);
            if (n > 1) entry.id = `${entry.id}-${n}`;
            const problem = commentaryEntryProblem(entry) ?? traceableProblem(entry, pages);
            if (problem) throw new Error(`[catena] ${scan.item}: ${problem}`);
            entries.push(entry);
        }
        log(`[catena] ${scan.item} (${scan.gospel} ${scan.chapters[0]}-${scan.chapters[1]}): ${blocks.length} blocks, ${blocks.reduce((n, b) => n + b.excerpts.length, 0)} excerpts, unknown tokens ${Object.keys(r.unknownTokens).length}, repaired ${Object.keys(r.repairedTokens).length}`);
    }
    return { entries, report };
}

if (process.argv[1] && process.argv[1].endsWith('import-catena-aurea.ts')) {
    const arg = process.argv.indexOf('--chapters');
    const chapters = arg > 0 ? new Set(process.argv[arg + 1].split(',')) : undefined;
    const { entries, report } = importCatena({ chapters });
    const out = chapters
        ? path.join(dataDir, 'processed', '_samples', 'commentary-catena-aurea.sample.json')
        : path.join(dataDir, 'processed', 'commentary-catena-aurea.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(entries), 'utf-8');
    fs.writeFileSync(out.replace(/\.json$/, '.report.json'), JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[catena] Written: ${out} (${entries.length} entries)`);
}
