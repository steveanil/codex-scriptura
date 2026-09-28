/**
 * Error-detection oracle for the Catena Aurea import (issue #85).
 *
 * Compares the entries produced from the 1841 scans with the Dominican
 * House of Studies transcription (data/texts/catena/oracle/CA<Gospel>.htm,
 * never redistributed and never copied from): the same lemma blocks should
 * exist with the same excerpts in the same order, and each excerpt's text
 * should match closely. Every disagreement is a candidate OCR error to be
 * resolved against the page image and entered as a correction. The report
 * names the scanned page for each one.
 *
 *   pnpm run verify:catena -- data/processed/_samples/commentary-catena-aurea.sample.json
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RawCommentaryEntry } from '@codex-scriptura/core';
import { sourceLocatorUrl } from '@codex-scriptura/core';
import { dataDir } from './core/paths.js';

type OracleExcerpt = { author: string; text: string };
type OracleBlock = { chapter: number; verseStart: number; verseEnd: number; excerpts: OracleExcerpt[] };

const GOSPEL_FILE: Record<string, string> = { Matt: 'CAMatthew.htm', Mark: 'CAMark.htm', Luke: 'CALuke.htm', John: 'CAJohn.htm' };

function decodeHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\uFFFD/g, "'").replace(/\s+/g, ' ').trim();
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
const fromRoman = (r: string) => [...r].reduce((t, c, i, a) => t + ((ROMAN[a[i + 1]] ?? 0) > ROMAN[c] ? -ROMAN[c] : ROMAN[c]), 0);

/**
 * The transcription's blocks for one chapter. The files come in two
 * layouts: Matthew's marks chapters "Gospel of Matthew, Chapter N", lemma
 * verses in red spans and authors in blue spans followed by a colon;
 * John's marks chapters with an anchor and "CHAPTER I", lemma verses in
 * #ff0000 spans ("1a. In the beginning") and authors in bold ("<b>CHRYS</b>.").
 */
export function oracleBlocks(html: string, chapter: number): OracleBlock[] {
    const heads = [...html.matchAll(/(?:Chapter (\d+)<\/span>|<span style="font-weight: bold">CHAPTER ([IVXL]+)<\/span>)/g)]
        .map((m) => ({ chapter: m[1] ? Number(m[1]) : fromRoman(m[2]), index: m.index! }));
    const at = heads.findIndex((h) => h.chapter === chapter);
    if (at < 0) return [];
    const section = html.slice(heads[at].index, heads[at + 1]?.index ?? html.length);
    const paras = [...section.matchAll(/<p[^>]*>([\s\S]*?)(?=<p|<hr|$)/g)].map((m) => m[1]);
    const blocks: OracleBlock[] = [];
    let current: OracleBlock | null = null;
    let inLemma = false;
    for (const p of paras) {
        const text = decodeHtml(p);
        if (!text || text.startsWith('[p.') || /^CHAPTER [IVXL]+$/.test(text) || p.includes('color:green')) continue;
        if (p.includes('color:red') || p.includes('color: #ff0000')) {
            const n = /^(\d+)[a-z]?\./.exec(text);
            const v = n ? Number(n[1]) : NaN;
            if (!inLemma) { current = { chapter, verseStart: v, verseEnd: v, excerpts: [] }; blocks.push(current); inLemma = true; }
            else if (current && !Number.isNaN(v)) current.verseEnd = v;
            continue;
        }
        inLemma = false;
        if (!current) continue;
        if (p.includes('color:blue')) {
            const m = /^([^:]{1,60}?)(?:,\s*([^:]*))?:\s*(.*)$/.exec(text);
            current.excerpts.push({ author: m ? m[1].trim() : '?', text: m ? m[3] : text });
        } else if (/<b>[A-Z][A-Za-z.\- ]{2,}<\/b>/.test(p)) {
            // John's layout runs several Fathers inline in one paragraph, each opened by a bold token
            const parts = p.split(/<b>([A-Z][A-Za-z.\- ]{2,})<\/b>[.;:]?/);
            if (parts[0].trim() && current.excerpts.length) current.excerpts[current.excerpts.length - 1].text += ' ' + decodeHtml(parts[0]);
            for (let k = 1; k < parts.length; k += 2) current.excerpts.push({ author: parts[k].trim(), text: decodeHtml(parts[k + 1] ?? '') });
        } else if (current.excerpts.length) {
            current.excerpts[current.excerpts.length - 1].text += ' ' + text;
        }
    }
    return blocks;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** Word-level similarity in [0, 1]: length of the longest common subsequence over the longer text. */
export function similarity(a: string, b: string): number {
    const x = norm(a), y = norm(b);
    if (x.length === 0 && y.length === 0) return 1;
    const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) {
        dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
    return dp[x.length][y.length] / Math.max(x.length, y.length);
}

/** Words of `ours` that the oracle lacks and vice versa, for a quick look at what the OCR got wrong. */
function wordDiff(ours: string, oracle: string): { extra: string[]; missing: string[] } {
    const a = norm(ours), b = norm(oracle);
    const bc = new Map<string, number>(); for (const w of b) bc.set(w, (bc.get(w) ?? 0) + 1);
    const ac = new Map<string, number>(); for (const w of a) ac.set(w, (ac.get(w) ?? 0) + 1);
    const extra = a.filter((w) => { const n = bc.get(w) ?? 0; if (n > 0) { bc.set(w, n - 1); return false; } return true; });
    const missing = b.filter((w) => { const n = ac.get(w) ?? 0; if (n > 0) { ac.set(w, n - 1); return false; } return true; });
    return { extra, missing };
}

type Finding = { id: string; page: string; kind: string; detail: string };

/**
 * Align our excerpts with the oracle's in order, so one missed or extra
 * token does not shift every later comparison. Standard sequence
 * alignment: a pair scores by text similarity (with a bonus when the
 * authors agree), a gap costs a little. Returns index pairs with -1 for
 * a gap on either side.
 */
export function alignExcerpts(ours: OracleExcerpt[], oracle: OracleExcerpt[]): Array<[number, number]> {
    const n = ours.length, m = oracle.length;
    const score = (i: number, j: number) => {
        const s = similarity(ours[i].text, oracle[j].text);
        const sameAuthor = norm(ours[i].author).join(' ').slice(0, 4) === norm(oracle[j].author).join(' ').slice(0, 4);
        return s * 2 - 0.6 + (sameAuthor ? 0.3 : 0);
    };
    const GAP = -0.25;
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const back = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
    for (let i = 1; i <= n; i++) { dp[i][0] = i * GAP; back[i][0] = 1; }
    for (let j = 1; j <= m; j++) { dp[0][j] = j * GAP; back[0][j] = 2; }
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
        const diag = dp[i - 1][j - 1] + score(i - 1, j - 1);
        const up = dp[i - 1][j] + GAP;
        const left = dp[i][j - 1] + GAP;
        if (diag >= up && diag >= left) { dp[i][j] = diag; back[i][j] = 0; }
        else if (up >= left) { dp[i][j] = up; back[i][j] = 1; }
        else { dp[i][j] = left; back[i][j] = 2; }
    }
    const pairs: Array<[number, number]> = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        const b = i === 0 ? 2 : j === 0 ? 1 : back[i][j];
        if (b === 0) { pairs.push([i - 1, j - 1]); i--; j--; }
        else if (b === 1) { pairs.push([i - 1, -1]); i--; }
        else { pairs.push([-1, j - 1]); j--; }
    }
    return pairs.reverse();
}

/** Our excerpts as (author, text) pairs read back from the Markdown we emit. */
function ourExcerpts(entry: RawCommentaryEntry): OracleExcerpt[] {
    return entry.content.split('\n\n').filter((p) => p.startsWith('**')).map((p) => {
        const m = /^\*\*(.+?)\.\*\*(?: \(\*.*?\*\))? (.*)$/s.exec(p);
        return { author: m ? m[1] : '?', text: m ? m[2] : p };
    });
}

export function verify(entries: RawCommentaryEntry[], oracleDir: string): { findings: Finding[]; summary: Record<string, unknown> } {
    const findings: Finding[] = [];
    let compared = 0, close = 0;
    const byGospel = new Map<string, RawCommentaryEntry[]>();
    for (const e of entries) { const g = e.startRef.split('.')[0]; byGospel.set(g, [...(byGospel.get(g) ?? []), e]); }
    for (const [gospel, ours] of byGospel) {
        const html = fs.readFileSync(path.join(oracleDir, GOSPEL_FILE[gospel]), 'latin1');
        const chapters = new Set(ours.map((e) => Number(e.startRef.split('.')[1])));
        for (const ch of chapters) {
            const oracle = oracleBlocks(html, ch);
            const mine = ours.filter((e) => Number(e.startRef.split('.')[1]) === ch);
            const oracleRanges = oracle.map((b) => `${b.verseStart}-${b.verseEnd}`);
            const mineRanges = mine.map((e) => `${e.startRef.split('.')[2]}-${e.endRef.split('.')[2]}`);
            if (oracleRanges.join(' ') !== mineRanges.join(' ')) {
                findings.push({ id: `${gospel}.${ch}`, page: '', kind: 'block-boundaries', detail: `ours ${mineRanges.join(' ')} | oracle ${oracleRanges.join(' ')}` });
            }
            // A verse split over several lemma blocks gives the same range more than once; pair them in order
            const pending = new Map<string, OracleBlock[]>();
            for (const b of oracle) { const k = `${b.verseStart}-${b.verseEnd}`; pending.set(k, [...(pending.get(k) ?? []), b]); }
            for (const e of mine) {
                const range = `${e.startRef.split('.')[2]}-${e.endRef.split('.')[2]}`;
                const ob = pending.get(range)?.shift();
                const page = e.source ? `${sourceLocatorUrl(e.source)} (p. ${e.source.pageStart ?? '?'}-${e.source.pageEnd ?? '?'})` : '';
                if (!ob) { findings.push({ id: e.id, page, kind: 'no-oracle-block', detail: '' }); continue; }
                const oe = ourExcerpts(e);
                const pairs = alignExcerpts(oe, ob.excerpts);
                for (const [i, j] of pairs) {
                    if (i < 0) { findings.push({ id: `${e.id}#oracle${j + 1}`, page, kind: 'missing-excerpt', detail: `oracle has ${ob.excerpts[j].author}: ${ob.excerpts[j].text.slice(0, 90)}` }); continue; }
                    if (j < 0) { findings.push({ id: `${e.id}#${i + 1}`, page, kind: 'extra-excerpt', detail: `ours has ${oe[i].author}: ${oe[i].text.slice(0, 90)}` }); continue; }
                    compared++;
                    const s = similarity(oe[i].text, ob.excerpts[j].text);
                    if (s >= 0.97) { close++; continue; }
                    const d = wordDiff(oe[i].text, ob.excerpts[j].text);
                    findings.push({ id: `${e.id}#${i + 1}`, page, kind: 'text', detail: `${oe[i].author} vs ${ob.excerpts[j].author}: similarity ${s.toFixed(3)}; extra [${d.extra.slice(0, 12).join(' ')}] missing [${d.missing.slice(0, 12).join(' ')}]` });
                }
            }
        }
    }
    return { findings, summary: { entries: entries.length, excerptsCompared: compared, within3pct: close, findings: findings.length } };
}

if (process.argv[1] && process.argv[1].endsWith('verify-catena-oracle.ts')) {
    const file = process.argv[2] ?? path.join(dataDir, 'processed', 'commentary-catena-aurea.json');
    const entries = JSON.parse(fs.readFileSync(file, 'utf-8')) as RawCommentaryEntry[];
    const { findings, summary } = verify(entries, path.join(dataDir, 'texts', 'catena', 'oracle'));
    const out = file.replace(/\.json$/, '.oracle-report.json');
    fs.writeFileSync(out, JSON.stringify({ summary, findings }, null, 2), 'utf-8');
    console.log('[catena-oracle]', JSON.stringify(summary));
    for (const f of findings.slice(0, 40)) console.log(`  ${f.kind.padEnd(16)} ${f.id.padEnd(24)} ${f.detail.slice(0, 160)}${f.page ? '\n' + ' '.repeat(42) + f.page : ''}`);
    if (findings.length > 40) console.log(`  ... ${findings.length - 40} more in ${out}`);
}
