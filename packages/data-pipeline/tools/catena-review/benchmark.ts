/**
 * Scores the Catena OCR benchmark (benchmark/catena/README.md) against the checked transcriptions, stage by stage:
 *
 *   recogniser       every line the OCR document saved, before any reading: a word-bag discrepancy rate (words missing
 *                    and invented, order aside, printed fragments kept as fragments on both sides)
 *                    (the recogniser does not tell text from margin, so it is measured against every printed word)
 *   page reader      the page's text lines after the page reader (column, cuts, joins, table repairs, verified
 *                    suggestions): character and word error in order, lines missing or read twice, margin text
 *   complete reader  the chain as the parser leaves it (tokens, every whole-chain pass, excerpt cleanup, verified
 *                    suggestions), before any manual correction: character and word error in order
 *
 * and every change logged on the page, judged in the printed line it was made on.
 *
 *   pnpm exec tsx tools/catena-review/benchmark.ts score [--split development|held-out]
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../src/core/paths.js';
import { CATENA_SCANS, editionVocabulary, englishLexicon, readScanPages, verseCountsFor } from '../../src/import-catena-aurea.js';
import { pageLines, scanMetrics, type OcrPage } from '../../src/importers/djvu-xml.js';
import { parseCatenaPages, emptyReport } from '../../src/importers/catena-aurea.js';
import { loadReaderForms, loadVerifiedTransforms, readerLog, type Transform, type Traced } from '../../src/importers/transform-log.js';
import type { RapidOcrDocument } from '../../src/importers/rapidocr-json.js';
import { parseTranscription, running, errorRates, recogniserDiscrepancy, alignLines, lineMatch, readerPageText, judge, regionFor } from '../../src/catena-benchmark.js';

const root = path.resolve(import.meta.dirname, '..', '..', 'benchmark', 'catena');
const pages = JSON.parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf-8')) as Record<string, { item: string; leaf: number; kind: string }[]>;
const split = process.argv.includes('--split') ? process.argv[process.argv.indexOf('--split') + 1] : undefined;
const textsDir = path.join(dataDir, 'texts', 'catena');
const vocab = editionVocabulary(textsDir), english = englishLexicon(path.dirname(textsDir)), forms = loadReaderForms();
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
    const sum = { recogniser: [0, 0], page: [0, 0], complete: [0, 0], chars: 0, words: 0, missing: 0, twice: 0, agrees: 0, contradicts: 0, unclear: 0, scored: 0 };
    for (const p of list) {
        const file = path.join(root, 'transcriptions', `${p.item}-${p.leaf}.txt`);
        if (!fs.existsSync(file)) { console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): no transcription`); continue; }
        const t = parseTranscription(fs.readFileSync(file, 'utf-8'));
        if (!t.checked) { console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): transcription not checked, not scored`); continue; }
        const s = read(p.item);
        const ref = running(t.text);
        const printed = [...t.text, ...t.margin, ...t.footnotes];
        const saved = s.doc.pages.find((x) => x.leaf === p.leaf)!.lines.slice().sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
        const recogniser = recogniserDiscrepancy(printed, saved.map((l) => l.text));
        const printedWords = printed.join(' ').split(/\s+/).filter(Boolean);
        const page = s.pages.find((x) => x.leaf === p.leaf)!;
        const lines = pageLines(page, scanMetrics(s.pages)).lines;
        const pageText = errorRates(ref, running(lines.map((l) => l.main)));
        const complete = errorRates(ref, readerPageText(lines, s.chains, p.leaf));
        const coverage = lineMatch(t.text, lines.map((l) => l.main));
        const margin = errorRates(running(t.margin), running(lines.map((l) => l.margin).filter(Boolean)));
        // A change is judged in the printed line aligned to the line it was made on; a margin change in the margin
        const body = lines.map((l) => ({ y: l.y, text: l.main })), side = lines.filter((l) => l.margin).map((l) => ({ y: l.y, text: l.margin }));
        const bodyOf = alignLines(t.text, body.map((l) => l.text)), sideOf = alignLines(t.margin, side.map((l) => l.text));
        const changes = s.transforms.filter((x) => x.leaf === p.leaf && x.rule !== 'spacing').map((x) => {
            const inMargin = /@\d+m:/.test(x.span ?? '') || x.rule.startsWith('citation:');
            const wide = /\s/.test(x.from.trim());
            return { ...x, verdict: judge(x, inMargin ? regionFor(x.y, side, t.margin, sideOf, wide) : regionFor(x.y, body, t.text, bodyOf, wide)) };
        });
        console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): recogniser word-bag discrepancy ${rate(recogniser.rate, recogniser.extra)} (${recogniser.missing} missing, ${recogniser.extra} invented) | page reader CER ${rate(pageText.cer, pageText.charEdits)} WER ${rate(pageText.wer, pageText.wordEdits)} | complete reader CER ${rate(complete.cer, complete.charEdits)} WER ${rate(complete.wer, complete.wordEdits)} | lines missing ${coverage.missing.length}, read twice ${coverage.twice.length} | margin CER ${rate(margin.cer, margin.charEdits)}`);
        for (const c of changes.filter((x) => x.verdict !== 'agrees')) console.log(`    ${c.verdict.padEnd(11)} ${c.applied ? 'made     ' : 'suggested'} ${c.id} ${c.rule}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
        sum.recogniser[0] += recogniser.missing + recogniser.extra; sum.page[0] += pageText.charEdits; sum.page[1] += pageText.wordEdits; sum.complete[0] += complete.charEdits; sum.complete[1] += complete.wordEdits;
        sum.chars += pageText.chars; sum.words += printedWords.length; sum.missing += coverage.missing.length; sum.twice += coverage.twice.length; sum.scored++;
        for (const c of changes) sum[c.verdict]++;
    }
    if (sum.scored) console.log(`${name}: ${sum.scored} pages | recogniser word-bag discrepancy ${rate(sum.words ? sum.recogniser[0] / sum.words : null, sum.recogniser[0])} | page reader CER ${rate(sum.chars ? sum.page[0] / sum.chars : null, sum.page[0])} | complete reader CER ${rate(sum.chars ? sum.complete[0] / sum.chars : null, sum.complete[0])} | lines missing ${sum.missing}, read twice ${sum.twice} | changes agreeing ${sum.agrees}, contradicting ${sum.contradicts}, unclear ${sum.unclear}`);
}
