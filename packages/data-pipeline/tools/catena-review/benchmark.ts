/**
 * Scores the Catena OCR benchmark (benchmark/catena/README.md) against the checked transcriptions, stage by stage:
 *
 *   recogniser       every line the OCR document saved, before any reading: a word-bag discrepancy rate (words missing
 *                    and invented, order aside, printed fragments kept as fragments on both sides)
 *                    (the recogniser does not tell text from margin, so it is measured against every printed word)
 *   page reader      the page's text lines after the page reader (column, cuts, joins, table repairs, verified
 *                    suggestions), line by line with no join: character and word error in order, lines missing
 *                    or read twice, margin text
 *   complete reader  the chain as the parser leaves it (tokens, every whole-chain pass, excerpt cleanup, verified
 *                    suggestions), before any manual correction: character and word error in order, against the
 *                    reference joined as the transcription marks each line's end
 *
 * and every change logged on the page, judged in the printed line it was made on.
 *
 *   pnpm exec tsx tools/catena-review/benchmark.ts score [--split development|held-out] [--record NAME]
 *
 * --record writes benchmark/catena/baselines/NAME.json: the scores, and everything they depend on (the commit and
 * the scorer's own files, each OCR document's checksum and provenance, the reader's forms and verified records,
 * and each transcription's checksum with who drafted and checked it), so a later run can be compared knowing
 * what changed. It refuses to record from a working tree whose scorer or reader files differ from the commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dataDir } from '../../src/core/paths.js';
import { CATENA_SCANS, editionVocabulary, englishLexicon, readScanPages, verseCountsFor } from '../../src/import-catena-aurea.js';
import { pageLines, scanMetrics, type OcrPage } from '../../src/importers/djvu-xml.js';
import { parseCatenaPages, emptyReport } from '../../src/importers/catena-aurea.js';
import { loadReaderForms, loadVerifiedTransforms, readerLog, type Transform, type Traced } from '../../src/importers/transform-log.js';
import type { RapidOcrDocument } from '../../src/importers/rapidocr-json.js';
import { parseTranscription, running, errorRates, recogniserDiscrepancy, alignLines, lineMatch, readerPageText, judge, regionFor, aggregate, type PageScore } from '../../src/catena-benchmark.js';

const root = path.resolve(import.meta.dirname, '..', '..', 'benchmark', 'catena');
const pages = JSON.parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf-8')) as Record<string, { item: string; leaf: number; kind: string }[]>;
const split = process.argv.includes('--split') ? process.argv[process.argv.indexOf('--split') + 1] : undefined;
const textsDir = path.join(dataDir, 'texts', 'catena');
const vocab = editionVocabulary(textsDir), english = englishLexicon(path.dirname(textsDir)), forms = loadReaderForms();
const recordAs = process.argv.includes('--record') ? process.argv[process.argv.indexOf('--record') + 1] : undefined;
const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pipeline = path.resolve(import.meta.dirname, '..', '..');
// The files whose content decides a score: the scorer, the reader, and the reader's checked tables and records
const SCORED_BY = ['tools/catena-review/benchmark.ts', 'src/catena-benchmark.ts', 'src/importers/transform-log.ts', 'src/importers/catena-aurea.ts', 'src/importers/rapidocr-json.ts', 'src/importers/djvu-xml.ts', 'src/import-catena-aurea.ts', 'corrections/catena-aurea.reader-forms.json', 'corrections/catena-aurea.transforms-verified.json'];
const record: { name?: string; results: unknown[]; transcriptions: unknown[]; ocr: Record<string, unknown> } = { results: [], transcriptions: [], ocr: {} };
if (recordAs) {
    const dirty = execSync(`git status --porcelain -- ${SCORED_BY.join(' ')}`, { cwd: pipeline, encoding: 'utf-8' }).trim();
    if (dirty) throw new Error(`[benchmark] not recording: scorer or reader files differ from the commit:\n${dirty}`);
}
const rate = (x: number | null, edits: number) => (x === null ? `n/a (${edits} invented)` : `${(100 * x).toFixed(1)}%`);

// Each scan read once: the page reader's pages, the chains as the parser leaves them, and the changes it logged
const scans = new Map<string, { pages: OcrPage[]; chains: Traced[]; transforms: Transform[]; doc: RapidOcrDocument }>();
const read = (item: string) => {
    if (!scans.has(item)) {
        const scan = CATENA_SCANS.find((s) => s.item === item)!;
        const reader = readerLog(loadVerifiedTransforms());
        const got = readScanPages(scan, textsDir, { vocab, forms, log: reader.log });
        const chains: Traced[] = [];
        parseCatenaPages(got, item, verseCountsFor(scan.gospel), emptyReport(), { firstChapter: scan.chapters[0], vocabulary: vocab, english, forms, log: reader.log, onChainText: (t) => chains.push(t) });
        const doc = JSON.parse(fs.readFileSync(path.join(textsDir, 'ocr', `${item}.rapidocr.json`), 'utf-8')) as RapidOcrDocument;
        scans.set(item, { pages: got, chains, transforms: reader.transforms, doc });
    }
    return scans.get(item)!;
};

for (const [name, list] of Object.entries(pages)) {
    if (name.startsWith('_') || (split && name !== split)) continue;
    const scores: PageScore[] = [];
    const sum = { missing: 0, twice: 0, agrees: 0, contradicts: 0, unclear: 0 };
    for (const p of list) {
        const file = path.join(root, 'transcriptions', `${p.item}-${p.leaf}.txt`);
        if (!fs.existsSync(file)) { console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): no transcription`); continue; }
        const t = parseTranscription(fs.readFileSync(file, 'utf-8'));
        if (!t.checked) { console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): transcription not checked, not scored`); continue; }
        const s = read(p.item);
        // The page reader makes no join, so it is measured line by line; the complete reader has joined, so its
        // reference joins as the transcription marks each line's end
        const lined = running(t.text), joined = running(t.text, t.joins);
        const printed = [...t.text, ...t.margin, ...t.footnotes];
        const saved = s.doc.pages.find((x) => x.leaf === p.leaf)!.lines.slice().sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
        const recogniser = recogniserDiscrepancy(printed, saved.map((l) => l.text));
        const printedWords = printed.join(' ').split(/\s+/).filter(Boolean);
        const page = s.pages.find((x) => x.leaf === p.leaf)!;
        const lines = pageLines(page, scanMetrics(s.pages)).lines;
        const pageText = errorRates(lined, running(lines.map((l) => l.main)));
        const complete = errorRates(joined, readerPageText(lines, s.chains, p.leaf));
        const coverage = lineMatch(t.text, lines.map((l) => l.main));
        const margin = errorRates(running(t.margin), running(lines.map((l) => l.margin).filter(Boolean)));
        // A change is judged in the printed line aligned to the line it was made on; a margin change in the margin
        const body = lines.map((l) => ({ y: l.y, text: l.main })), side = lines.filter((l) => l.margin).map((l) => ({ y: l.y, text: l.margin }));
        const bodyOf = alignLines(t.text, body.map((l) => l.text)), sideOf = alignLines(t.margin, side.map((l) => l.text));
        const changes = s.transforms.filter((x) => x.leaf === p.leaf && x.rule !== 'spacing').map((x) => {
            const inMargin = /@\d+m:/.test(x.span ?? '') || x.rule.startsWith('citation:');
            const wide = /\s/.test(x.from.trim());
            return { ...x, verdict: judge(x, inMargin ? regionFor(x.y, side, t.margin, sideOf, wide) : regionFor(x.y, body, t.text, bodyOf, wide, t.joins)) };
        });
        console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): recogniser word-bag discrepancy ${rate(recogniser.rate, recogniser.extra)} (${recogniser.missing} missing, ${recogniser.extra} invented) | page reader CER ${rate(pageText.cer, pageText.charEdits)} WER ${rate(pageText.wer, pageText.wordEdits)} | complete reader CER ${rate(complete.cer, complete.charEdits)} WER ${rate(complete.wer, complete.wordEdits)} | lines missing ${coverage.missing.length}, read twice ${coverage.twice.length} | margin CER ${rate(margin.cer, margin.charEdits)}`);
        for (const c of changes.filter((x) => x.verdict !== 'agrees')) console.log(`    ${c.verdict.padEnd(11)} ${c.applied ? 'made     ' : 'suggested'} ${c.id} ${c.rule}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
        scores.push({ recogniser: { edits: recogniser.missing + recogniser.extra, words: printedWords.length }, page: pageText, complete });
        record.transcriptions.push({ split: name, item: p.item, leaf: p.leaf, sha256: sha(file), drafted: t.drafted, checked: t.checked });
        const d = s.doc;
        record.ocr[p.item] ??= { sha256: sha(path.join(textsDir, 'ocr', `${p.item}.rapidocr.json`)), source: d.source, engine: d.engine, generator: d.generator ?? null, migration: d.migration ?? null };
        record.results.push({ split: name, item: p.item, leaf: p.leaf, kind: p.kind, recogniser, page: pageText, complete, lines: { missing: coverage.missing.length, twice: coverage.twice.length }, margin, changes: { agrees: changes.filter((c) => c.verdict === 'agrees').length, contradicts: changes.filter((c) => c.verdict === 'contradicts').length, unclear: changes.filter((c) => c.verdict === 'unclear').length } });
        sum.missing += coverage.missing.length; sum.twice += coverage.twice.length;
        for (const c of changes) sum[c.verdict]++;
    }
    if (scores.length) {
        const all = aggregate(scores);
        const edits = (f: (p: PageScore) => number) => scores.reduce((n, p) => n + f(p), 0);
        console.log(`${name}: ${scores.length} pages | recogniser word-bag discrepancy ${rate(all.recogniser, edits((p) => p.recogniser.edits))} | page reader CER ${rate(all.pageCer, edits((p) => p.page.charEdits))} WER ${rate(all.pageWer, edits((p) => p.page.wordEdits))} | complete reader CER ${rate(all.completeCer, edits((p) => p.complete.charEdits))} WER ${rate(all.completeWer, edits((p) => p.complete.wordEdits))} | lines missing ${sum.missing}, read twice ${sum.twice} | changes agreeing ${sum.agrees}, contradicting ${sum.contradicts}, unclear ${sum.unclear}`);
    }
}

if (recordAs) {
    const out = path.join(root, 'baselines', `${recordAs}.json`);
    if (fs.existsSync(out)) throw new Error(`[benchmark] ${out} exists; a recorded baseline is never overwritten`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const commit = execSync('git rev-parse HEAD', { cwd: pipeline, encoding: 'utf-8' }).trim();
    fs.writeFileSync(out, `${JSON.stringify({ name: recordAs, recorded: new Date().toISOString().slice(0, 10), commit, scoredBy: Object.fromEntries(SCORED_BY.map((f) => [f, sha(path.join(pipeline, f))])), ocr: record.ocr, transcriptions: record.transcriptions, results: record.results }, null, 1)}\n`);
    console.log(`[benchmark] recorded ${out}`);
}
