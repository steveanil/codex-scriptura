/** Garbled author tokens behind the missing excerpts, by leaf: aligns ours with the transcription's per entry and finds the OCR line at the junction. */
import fs from 'node:fs';
import { CATENA_SCANS, readScanPages, editionVocabulary } from '/home/steveaj/Projects/codex-scriptura/packages/data-pipeline/src/import-catena-aurea.ts';
import { pageLines, scanMetrics } from '/home/steveaj/Projects/codex-scriptura/packages/data-pipeline/src/importers/djvu-xml.ts';
import { oracleBlocks, alignExcerpts } from '/home/steveaj/Projects/codex-scriptura/packages/data-pipeline/src/verify-catena-oracle.ts';
const T = '/home/steveaj/Projects/codex-scriptura/data/texts/catena';
const FILE: Record<string, string> = { Matt: 'CAMatthew.htm', Mark: 'CAMark.htm', Luke: 'CALuke.htm', John: 'CAJohn.htm' };
const entries = JSON.parse(fs.readFileSync('/home/steveaj/Projects/codex-scriptura/data/processed/commentary-catena-aurea.json', 'utf-8'));
const report = JSON.parse(fs.readFileSync('/home/steveaj/Projects/codex-scriptura/data/processed/commentary-catena-aurea.oracle-report.json', 'utf-8'));
const reviewed = new Set(JSON.parse(fs.readFileSync('/home/steveaj/Projects/codex-scriptura/packages/data-pipeline/corrections/catena-aurea.discrepancies.json', 'utf-8')).map((d: any) => `${d.kind}:${d.id}`));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const only = process.argv[2];
const cache = new Map<string, any>(); let vocab: any;
const linesOf = (item: string) => {
    if (!cache.has(item)) {
        const scan = CATENA_SCANS.find((s) => s.item === item)!;
        if (scan.ocr === 'rapidocr') vocab ??= editionVocabulary(T);
        const pages = readScanPages(scan, T, vocab); const m = scanMetrics(pages);
        cache.set(item, new Map(pages.map((p) => [p.leaf, pageLines(p, m).lines.map((l) => l.main)])));
    }
    return cache.get(item);
};
const html = new Map<string, string>();
const wanted = new Set(report.findings.filter((f: any) => f.kind === 'missing-excerpt' && (!only || f.item === only) && !reviewed.has(`missing-excerpt:${f.id}`)).map((f: any) => f.id.split('#')[0]));
const out: any[] = [];
for (const e of entries.filter((e: any) => wanted.has(e.id))) {
    const [book, ch, vs] = e.startRef.split('.'); const ve = e.endRef.split('.')[2];
    if (!html.has(book)) html.set(book, fs.readFileSync(`${T}/oracle/${FILE[book]}`, 'latin1'));
    const oracle = oracleBlocks(html.get(book)!, Number(ch)).filter((b) => b.verseStart === Number(vs) && b.verseEnd === Number(ve)).flatMap((b) => b.excerpts);
    const ours = e.content.split(/\n\n/).filter((p: string) => !p.startsWith('>')).map((p: string) => { const m = /^\*\*(.+?)\.\*\*\s*(?:\(\*([\s\S]*?)\*\)\s*)?([\s\S]*)$/.exec(p); return m ? { author: m[1], text: m[3] } : { author: '?', text: p }; });
    const pairs = alignExcerpts(ours, oracle);
    for (const [i, j] of pairs) {
        if (i >= 0 || j < 0) continue;
        const id = `${e.id}#oracle${j + 1}`; if (reviewed.has(`missing-excerpt:${id}`)) continue;
        const o = oracle[j]; const open = norm(o.text).split(' ').slice(0, 4).join(' ');
        let holder = ours.findIndex((x: any) => norm(x.text).includes(open));
        let junction = open;
        if (holder >= 0 && norm(ours[holder].text).indexOf(open) === 0 && oracle[j + 1]) { junction = norm(oracle[j + 1].text).split(' ').slice(0, 4).join(' '); if (!norm(ours[holder].text).includes(junction)) junction = ''; }
        const lines = linesOf(e.source.item);
        let hit: any = null;
        if (junction) for (let leaf = e.source.leafStart; leaf <= e.source.leafEnd && !hit; leaf++) {
            const ls: string[] = lines.get(leaf) ?? [];
            for (let k = 0; k < ls.length; k++) {
                const joined = `${ls[k]} ${ls[k + 1] ?? ''}`; const nj = norm(joined); const at = nj.indexOf(junction);
                if (at < 0) continue;
                const wordsBefore = nj.slice(0, at).trim().split(' ').length; const rawWords = joined.split(/\s+/);
                hit = { leaf, line: ls[k], before: rawWords.slice(Math.max(0, wordsBefore - 3), wordsBefore).join(' ') }; break;
            }
        }
        out.push({ id, item: e.source.item, author: o.author, opening: o.text.slice(0, 40), holder, ...(hit ?? { leaf: null, before: '' }) });
    }
}
const byLeaf = new Map<string, any[]>();
for (const o of out) { const k = `${o.item}:${o.leaf}`; byLeaf.set(k, [...(byLeaf.get(k) ?? []), o]); }
console.log('missing', out.length, 'located', out.filter((o) => o.leaf !== null).length, 'leaves', byLeaf.size, 'absent from ours', out.filter((o) => o.holder < 0).length);
for (const [k, list] of [...byLeaf.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    console.log(`## ${k}`);
    for (const o of list) console.log(`  ${o.id.padEnd(30)} ${o.author.padEnd(14)} token? ${JSON.stringify(o.before).padEnd(34)} | ${JSON.stringify(o.line?.slice(0, 60) ?? o.opening)}`);
}
fs.writeFileSync(`/home/steveaj/Projects/codex-scriptura/data/scratch/catena/cand-${only ?? 'all'}.json`, JSON.stringify(out, null, 1));
