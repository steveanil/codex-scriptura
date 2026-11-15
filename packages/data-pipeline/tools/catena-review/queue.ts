/**
 * The page-first review queue (src/catena-review-queue.ts): the pages to read on the image next, and how far
 * the unreadable-line pages have come. It reads the OCR documents, the line corrections and the reader's log
 * from the last import, and writes nothing but the list sheet.py draws from, in data/scratch/catena-review.
 *
 *   pnpm exec tsx tools/catena-review/queue.ts [count]        the first pages of the queue (25), with the counts
 *   pnpm exec tsx tools/catena-review/queue.ts <item> <leaf>  one page: its unreadable lines, their state, and the reader's lines there
 *
 * It also reads two records made from the page images: the footnote lines confirmed as footnotes
 * (corrections/catena-aurea.footnote-lines.json) and the page reviews (corrections/catena-aurea.page-reviews.json).
 * A record that matches nothing on its page stops the run.
 *
 * Pages on the benchmark's held-out split are never listed: nothing may be written from them. Only leaves the
 * corpus places in a chain are read. Run import:catena first, so the log is the current corpus's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../src/core/paths.js';
import { CATENA_SCANS, editionVocabulary, readScanPages } from '../../src/import-catena-aurea.js';
import { loadReaderForms, type Transform } from '../../src/importers/transform-log.js';
import { pageLines, scanMetrics } from '../../src/importers/djvu-xml.js';
import { loadLineCorrections } from '../../src/importers/catena-corrections.js';
import type { RapidOcrDocument } from '../../src/importers/rapidocr-json.js';
import { lineStates, suggestionCounts, pageStatus, rankPages, unreadableProgress, checkPageReviews, reviewScope, marginRead, everQueued, reviewCoverage, type QueuePage, type FootnoteLine, type PageReview } from '../../src/catena-review-queue.js';

// A reader that stops early (head) closes the pipe: that is not an error
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); else throw e; });

const textsDir = path.join(dataDir, 'texts', 'catena');
const processed = path.join(dataDir, 'processed');
const scratch = path.join(dataDir, 'scratch', 'catena-review');
const benchmark = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'benchmark', 'catena', 'pages.json'), 'utf-8')) as Record<string, { item: string; leaf: number }[] | string>;
const heldOut = new Set(Object.entries(benchmark).filter(([k, v]) => k !== 'development' && Array.isArray(v)).flatMap(([, v]) => (v as { item: string; leaf: number }[]).map((p) => `${p.item}#${p.leaf}`)));

const corpusFile = path.join(processed, 'commentary-catena-aurea.json'), logFile = path.join(processed, 'commentary-catena-aurea.transforms.json');
if (!fs.existsSync(corpusFile) || !fs.existsSync(logFile)) throw new Error('[queue] no built corpus: run import:catena');
const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf-8')) as { source: { item: string; leafStart: number; leafEnd: number } }[];
const inChain = new Set(corpus.flatMap((e) => Array.from({ length: e.source.leafEnd - e.source.leafStart + 1 }, (_, i) => `${e.source.item}#${e.source.leafStart + i}`)));
const log = JSON.parse(fs.readFileSync(logFile, 'utf-8')) as Transform[];
const byPage = new Map<string, Transform[]>();
for (const t of log) {
    const key = `${t.item}#${t.leaf}`;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key)!.push(t);
}

const corrections = loadLineCorrections();
// Open questions recorded against a leaf keep its page in the queue; the questions file is the only record of them
const questionsFile = path.resolve(import.meta.dirname, '..', '..', 'corrections', 'catena-aurea.questions.json');
const openQuestions = new Map<string, number>();
for (const q of (fs.existsSync(questionsFile) ? JSON.parse(fs.readFileSync(questionsFile, 'utf-8')) : []) as { status: string; item: string; leaf: number }[]) {
    if (q.status === 'open') openQuestions.set(`${q.item}#${q.leaf}`, (openQuestions.get(`${q.item}#${q.leaf}`) ?? 0) + 1);
}
const record = <T>(name: string): T[] => {
    const file = path.resolve(import.meta.dirname, '..', '..', 'corrections', name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) as T[] : [];
};
const footnoteLines = record<FootnoteLine>('catena-aurea.footnote-lines.json');
const reviews = checkPageReviews(record<PageReview>('catena-aurea.page-reviews.json'));
for (const r of reviews) if (heldOut.has(`${r.item}#${r.leaf}`)) throw new Error(`[queue] a page review is recorded for a held-out benchmark page: ${r.item} ${r.leaf}`);
const vocab = editionVocabulary(textsDir), forms = loadReaderForms();
const pages: QueuePage[] = [];
const readerOf = new Map<string, { y: number; main: string }[]>();
for (const scan of CATENA_SCANS) {
    const doc = JSON.parse(fs.readFileSync(path.join(textsDir, 'ocr', `${scan.item}.rapidocr.json`), 'utf-8')) as RapidOcrDocument;
    const read = readScanPages(scan, textsDir, { vocab, forms });
    const metrics = scanMetrics(read);
    const split = new Map(read.map((p) => [p.leaf, pageLines(p, metrics)]));
    const readerLines = new Map([...split].map(([leaf, s]) => [leaf, s.lines.map((l) => ({ y: l.y, main: l.main }))]));
    for (const p of doc.pages) {
        const key = `${scan.item}#${p.leaf}`;
        if (heldOut.has(key) || !inChain.has(key)) continue;
        readerOf.set(key, readerLines.get(p.leaf) ?? []);
        const page: QueuePage = {
            item: scan.item, leaf: p.leaf,
            lines: lineStates(p, readerLines.get(p.leaf) ?? [], corrections.filter((c) => c.item === scan.item && c.leaf === p.leaf), (split.get(p.leaf)?.footnotes ?? []).map((l) => ({ y: l.y, main: l.main })), footnoteLines.filter((f) => f.item === scan.item && f.leaf === p.leaf)),
            suggestions: suggestionCounts(byPage.get(key) ?? []),
            questions: openQuestions.get(key) ?? 0,
            review: reviewScope(reviews, scan.item, p.leaf),
            margin: marginRead(reviews, scan.item, p.leaf),
        };
        for (const f of footnoteLines.filter((x) => x.item === scan.item && x.leaf === p.leaf)) {
            if (!page.lines.some((l) => l.state === 'footnote' && l.y === f.y)) throw new Error(`[queue] the footnote line recorded at y ${f.y} on leaf ${f.leaf} of ${f.item} is not an unreadable line the reader filed under the footnotes with the reading "${f.reading}"`);
        }
        if (page.lines.length || page.questions || page.review || page.suggestions.weighty + page.suggestions.other + page.suggestions.low + page.suggestions.settled) pages.push(page);
    }
}

const ranked = rankPages(pages);
fs.mkdirSync(scratch, { recursive: true });
// With each unreadable line, the reader's lines around it: what a correction's find must give
const near = (p: QueuePage, y: number, height: number) => readerOf.get(`${p.item}#${p.leaf}`)!.filter((r) => Math.abs(r.y - y) <= 2 * height).map((r) => ({ y: r.y, main: r.main.trim() }));
fs.writeFileSync(path.join(scratch, 'queue.json'), JSON.stringify(ranked.map((p) => ({ ...p, lines: p.lines.map((l) => ({ ...l, reader: near(p, l.y, l.y2 - l.y1) })) })), null, 1) + '\n');

for (const r of reviews) if (!pages.some((p) => p.item === r.item && p.leaf === r.leaf)) throw new Error(`[queue] a page review is recorded for ${r.item} ${r.leaf}, which is not a leaf of the chain`);
const describe = (p: QueuePage) => `${p.item} ${p.leaf} (${pageStatus(p)}${p.review ? `, read on the image: ${p.review}` : ''}): unreadable ${p.lines.filter((l) => l.state === 'open' || l.state === 'unread').length} of ${p.lines.filter((l) => l.state !== 'footnote').length}${p.lines.some((l) => l.state === 'footnote') ? `, footnote lines ${p.lines.filter((l) => l.state === 'footnote').length}` : ''}, suggestions on scripture or tokens ${p.suggestions.weighty}, other ${p.suggestions.other}, low priority ${p.suggestions.low}, settled ${p.suggestions.settled}${p.questions ? `, open questions ${p.questions}` : ''}`;
const [a, b] = process.argv.slice(2);
if (a && b) {
    const p = pages.find((x) => x.item === a && x.leaf === Number(b));
    if (!p) console.log(`${a} ${b}: nothing to read (not in the chain, held out, or nothing was ever queued there)`);
    else {
        console.log(describe(p));
        for (const l of p.lines) {
            console.log(`    y ${l.y} (ocr ${l.y1}-${l.y2}) score ${l.score} ${l.state}: ${JSON.stringify(l.text)}`);
            // The reader's lines around it, as a correction's find must give them
            for (const r of near(p, l.y, l.y2 - l.y1)) console.log(`        reader y ${r.y}: ${JSON.stringify(r.main)}`);
        }
    }
} else {
    const u = unreadableProgress(pages);
    const status = (s: string) => pages.filter((p) => everQueued(p) && pageStatus(p) === s).length;
    console.log(`unreadable commentary: ${u.pagesOpen} of ${u.pages} pages still have an uncorrected line (${u.linesOpen} of ${u.lines} lines; ${u.linesUnread} of those the reader made no line of)`);
    console.log(`footnote lines read as specks, confirmed on the page image and left out with the footnotes: ${u.footnoteLines} | open questions ${[...openQuestions.values()].reduce((n, x) => n + x, 0)} on ${openQuestions.size} pages`);
    console.log(`OCR queue: ${status('open')} open, ${status('partial')} partly read, ${status('done')} done | suggestions left to read ${pages.reduce((n, p) => n + p.suggestions.weighty + p.suggestions.other + p.suggestions.low, 0)} (a pair on one character counted once; ${pages.reduce((n, p) => n + p.suggestions.low, 0)} of them low priority), settled ${pages.reduce((n, p) => n + p.suggestions.settled, 0)}`);
    const c = reviewCoverage(pages);
    console.log(`targeted review, by strips: ${c.strips} pages (${c.doneStrips} of them done in the queue)`);
    console.log(`whole-page review: ${c.whole} pages (${c.doneWhole} done in the queue, ${c.wholeNotDone} with something still queued) | done pages with no review of the text recorded: ${c.doneUnrecorded} of ${c.done}`);
    console.log(`margin citations read against the image: ${c.margin} pages in a reading of the margin alone (${c.marginOnly} of them with no reading of the text); a whole-page review reads the margin too`);
    for (const p of ranked.slice(0, Number(a) || 25)) console.log(describe(p));
}
