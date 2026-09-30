/**
 * Scores the Catena OCR benchmark (benchmark/catena/README.md) against the checked transcriptions.
 *
 *   pnpm exec tsx tools/catena-review/benchmark.ts score [--split development|held-out]
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../src/core/paths.js';
import { CATENA_SCANS, editionVocabulary, readScanPages } from '../../src/import-catena-aurea.js';
import { pageLines, scanMetrics } from '../../src/importers/djvu-xml.js';
import { loadReaderForms, loadVerifiedTransforms, readerLog, type Transform } from '../../src/importers/transform-log.js';
import { parseTranscription, running, errorRates, lineMatch, judge } from '../../src/catena-benchmark.js';

const root = path.resolve(import.meta.dirname, '..', '..', 'benchmark', 'catena');
const pages = JSON.parse(fs.readFileSync(path.join(root, 'pages.json'), 'utf-8')) as Record<string, { item: string; leaf: number; kind: string }[]>;
const split = process.argv.includes('--split') ? process.argv[process.argv.indexOf('--split') + 1] : undefined;
const textsDir = path.join(dataDir, 'texts', 'catena');
const transforms = JSON.parse(fs.readFileSync(path.join(dataDir, 'processed', 'commentary-catena-aurea.transforms.json'), 'utf-8')) as Transform[];
const review = JSON.parse(fs.readFileSync(path.join(dataDir, 'processed', 'commentary-catena-aurea.review-index.json'), 'utf-8')) as Record<string, { item: string; excerptLeaves: number[] }>;
const vocab = editionVocabulary(textsDir), forms = loadReaderForms();
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

for (const [name, list] of Object.entries(pages)) {
    if (name.startsWith('_') || (split && name !== split)) continue;
    const totals = { raw: [0, 0], reader: [0, 0], chars: 0, missing: 0, twice: 0, agrees: 0, contradicts: 0, unclear: 0, scored: 0 };
    for (const p of list) {
        const file = path.join(root, 'transcriptions', `${p.item}-${p.leaf}.txt`);
        if (!fs.existsSync(file)) { console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): no transcription`); continue; }
        const t = parseTranscription(fs.readFileSync(file, 'utf-8'));
        if (!t.checked) { console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): transcription not checked, not scored`); continue; }
        const scan = CATENA_SCANS.find((s) => s.item === p.item)!;
        const read = (withReader: boolean) => {
            const all = withReader ? readScanPages(scan, textsDir, { vocab, forms, log: readerLog(loadVerifiedTransforms()).log }) : readScanPages(scan, textsDir);
            const page = all.find((x) => x.leaf === p.leaf)!;
            return pageLines(page, scanMetrics(all));
        };
        const raw = read(false), reader = read(true);
        const ref = running(t.text);
        const r = errorRates(ref, running(raw.lines.map((l) => l.main))), d = errorRates(ref, running(reader.lines.map((l) => l.main)));
        const lines = lineMatch(t.text, raw.lines.map((l) => l.main));
        const margin = errorRates(running(t.margin), running(raw.lines.map((l) => l.margin).filter(Boolean)));
        const changes = transforms.filter((x) => x.item === p.item && x.leaf === p.leaf).map((x) => ({ ...x, verdict: judge(x, ref) }));
        const tokens = (ref.match(/(?:^|\s)(?:PSEUDO-)?[A-Z]{2,}[A-Z.\s]*[.;:]/g) ?? []).length;
        const found = Object.values(review).filter((v) => v.item === p.item).flatMap((v) => v.excerptLeaves).filter((l) => l === p.leaf).length;
        console.log(`${name} ${p.item} ${p.leaf} (${p.kind}): raw CER ${pct(r.cer)} WER ${pct(r.wer)} | reader CER ${pct(d.cer)} WER ${pct(d.wer)} | lines missing ${lines.missing.length}, read twice ${lines.twice.length} | margin CER ${pct(margin.cer)} | tokens printed ${tokens}, excerpts found ${found}`);
        for (const c of changes.filter((x) => x.verdict !== 'agrees')) console.log(`    ${c.verdict.padEnd(11)} ${c.applied ? 'made     ' : 'suggested'} ${c.rule}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
        totals.raw[0] += r.cer * r.chars; totals.raw[1] += r.wer * r.words; totals.reader[0] += d.cer * d.chars; totals.reader[1] += d.wer * d.words; totals.chars += r.chars;
        totals.missing += lines.missing.length; totals.twice += lines.twice.length; totals.scored++;
        for (const c of changes) totals[c.verdict]++;
    }
    if (totals.scored) console.log(`${name}: ${totals.scored} pages, raw CER ${pct(totals.raw[0] / totals.chars)}, reader CER ${pct(totals.reader[0] / totals.chars)}, lines missing ${totals.missing}, read twice ${totals.twice}, changes agreeing ${totals.agrees}, contradicting ${totals.contradicts}, unclear ${totals.unclear}`);
}
