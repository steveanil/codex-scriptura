/**
 * Line-level views of a scan part as the parser reads it, for writing and checking line corrections.
 *
 *   pnpm exec tsx tools/catena-review/linecheck.ts [item]                line corrections that do not apply exactly once
 *   pnpm exec tsx tools/catena-review/linecheck.ts <item> <leaf>         the leaf's lines with indent, height and margin
 *   pnpm exec tsx tools/catena-review/linecheck.ts <item> <leaf> foot    its footnote lines
 *   pnpm exec tsx tools/catena-review/linecheck.ts <item> <leaf> metrics|gaps|allgaps
 *   pnpm exec tsx tools/catena-review/linecheck.ts <item> footscan       pages whose footnotes look like text
 */
import path from 'node:path';
import { dataDir } from '../../src/core/paths.js';
import { CATENA_SCANS, editionVocabulary, readScanPages } from '../../src/import-catena-aurea.js';
import { loadReaderForms } from '../../src/importers/transform-log.js';
import { pageLines, scanMetrics } from '../../src/importers/djvu-xml.js';
import { loadLineCorrections } from '../../src/importers/catena-corrections.js';
const textsDir = path.join(dataDir, 'texts', 'catena');
const vocab = editionVocabulary(textsDir);
const forms = loadReaderForms();
const read = (scan: (typeof CATENA_SCANS)[number]) => readScanPages(scan, textsDir, { vocab, forms });
const fixes = loadLineCorrections();
const only = process.argv[2];
for (const scan of CATENA_SCANS) {
    if (only && scan.item !== only) continue;
    const pages = read(scan);
    const metrics = scanMetrics(pages);
    const byLeaf = new Map<number, string[]>();
    for (const p of pages) byLeaf.set(p.leaf, pageLines(p, metrics).lines.map((l: any) => l.main));
    for (const c of fixes.filter((f) => f.item === scan.item)) {
        const lines = byLeaf.get(c.leaf) ?? [];
        const n = lines.reduce((t, l) => t + (l.split(c.find).length - 1), 0);
        if (n === 1) continue;
        const head = c.find.slice(0, 10);
        const near = lines.filter((l) => l.includes(head) || l.includes(c.find.slice(-10)));
        console.log(JSON.stringify({ item: scan.item, leaf: c.leaf, find: c.find, replace: c.replace, applied: n, near }));
    }
}
if (process.argv[3]) {
    const scan = CATENA_SCANS.find((x) => x.item === process.argv[2])!;
    const pages = read(scan);
    const p = pages.find((x) => x.leaf === Number(process.argv[3]))!;
    pageLines(p, scanMetrics(pages)).lines.forEach((l: any, i: number) => console.log(i, "indent", l.indent, "h", l.height, JSON.stringify(l.main), l.margin ? "| " + JSON.stringify(l.margin) : ""));
}
if (process.argv[3] && process.argv[4] === 'foot') {
    const scan = CATENA_SCANS.find((x) => x.item === process.argv[2])!;
    const pages = read(scan);
    const p = pages.find((x) => x.leaf === Number(process.argv[3]))!;
    pageLines(p, scanMetrics(pages)).footnotes.forEach((l: any, i: number) => console.log('FOOT', i, 'indent', l.indent, JSON.stringify(l.main), l.margin ? '| ' + JSON.stringify(l.margin) : ''));
}
if (process.argv[3] && process.argv[4] === 'metrics') {
    const scan = CATENA_SCANS.find((x) => x.item === process.argv[2])!;
    const pages = read(scan);
    const p = pages.find((x) => x.leaf === Number(process.argv[3]))!;
    const { lines, footnotes } = pageLines(p, scanMetrics(pages));
    const all = [...lines, ...footnotes];
    const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    console.log('page median height', med(all.map((l: any) => l.height)), 'charWidth', med(all.filter((l: any) => l.charWidth > 0).map((l: any) => l.charWidth)), 'scan', JSON.stringify(scanMetrics(pages)));
    all.slice(-10).forEach((l: any) => console.log(footnotes.includes(l) ? 'FOOT' : 'LINE', 'h', l.height, 'cw', l.charWidth.toFixed(1), JSON.stringify(l.main.slice(0, 50))));
}
if (process.argv[3] && process.argv[4] === 'gaps') {
    const scan = CATENA_SCANS.find((x) => x.item === process.argv[2])!;
    const pages = read(scan);
    const p = pages.find((x) => x.leaf === Number(process.argv[3]))!;
    const m = scanMetrics(pages);
    for (const l of p.lines.slice(-14)) {
        const ws = l.words.filter((w: any) => !w.margin && !w.forcedMargin).sort((a: any, b: any) => a.x1 - b.x1);
        let gap = 0, at = 0;
        for (let i = 1; i < ws.length; i++) { const g = ws[i].x1 - ws[i - 1].x2; if (g > gap) { gap = g; at = ws[i - 1].x2; } }
        const span = ws.length ? ws[ws.length - 1].x2 - ws[0].x1 : 0;
        console.log('gap', (gap / m.charWidth).toFixed(1), 'x', at, 'x1', ws[0]?.x1, 'x2', ws[ws.length - 1]?.x2, JSON.stringify(ws.map((w: any) => w.text).join(' ').slice(0, 70)));
    }
}
if (process.argv[3] && process.argv[4] === 'allgaps') {
    const scan = CATENA_SCANS.find((x) => x.item === process.argv[2])!;
    const pages = read(scan);
    const p = pages.find((x) => x.leaf === Number(process.argv[3]))!;
    const m = scanMetrics(pages);
    const { lines, footnotes } = pageLines(p, m);
    for (const l of [...lines, ...footnotes].slice(-10)) console.log((footnotes.includes(l) ? 'FOOT' : 'LINE'), JSON.stringify(l.gaps.map((g: number) => Math.round(g))), JSON.stringify(l.main.slice(0, 40)));
}
if (process.argv[2] && process.argv[3] === 'footscan') {
    const scan = CATENA_SCANS.find((x) => x.item === process.argv[2])!;
    const pages = read(scan);
    const m = scanMetrics(pages);
    for (const p of pages) {
        const { footnotes } = pageLines(p, m);
        const bad = footnotes.filter((l: any) => l.margin.trim() || /^\d{1,3}\.\s+[A-Z]/.test(l.main.trim()));
        if (bad.length) console.log('SUSPECT leaf', p.leaf, footnotes.length, 'footnotes;', bad.length, 'with margin or verse:', JSON.stringify(bad[0].main.slice(0, 60)), '|', bad[0].margin);
    }
}
