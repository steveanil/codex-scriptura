/**
 * Scoring for the Catena Aurea OCR benchmark (issue #85, benchmark/catena):
 * transcriptions read from the page images, against which the recogniser's
 * text, the reader's page text and every change the reader logged on the
 * page are measured.
 */

/** How a text line ends: a word broken over the line (its hyphen falls away), a hyphenated word (its hyphen stays), or neither. */
export type LineEnd = 'break' | 'hyphen' | null;
export type Transcription = { item: string; leaf: number; drafted: string; checked: string; text: string[]; joins: LineEnd[]; margin: string[]; footnotes: string[] };

/** A transcription file: `# key: value` headers, then `== text`, `== margin` and `== footnotes` sections of printed lines. */
export function parseTranscription(file: string): Transcription {
    const head: Record<string, string> = {};
    const sections: Record<string, string[]> = { text: [], margin: [], footnotes: [] };
    let at: string | null = null;
    for (const raw of file.split('\n')) {
        const line = raw.trimEnd();
        const h = /^#\s*(\w+):\s*(.*)$/.exec(line);
        if (h && at === null) { head[h[1]] = h[2].trim(); continue; }
        const s = /^==\s*(text|margin|footnotes)\s*$/.exec(line);
        if (s) { at = s[1]; continue; }
        if (at && line.trim()) sections[at].push(line.trim());
    }
    // A line ending "-=" prints a hyphenated word whose hyphen stays; "-" a word broken over the line. The mark is the
    // transcriber's reading of the page, not a guess from the letters
    const joins: LineEnd[] = sections.text.map((l) => (l.endsWith('-=') ? 'hyphen' : l.endsWith('-') ? 'break' : null));
    const text = sections.text.map((l) => (l.endsWith('-=') ? l.slice(0, -1) : l));
    return { item: head.item ?? '', leaf: Number(head.leaf), drafted: head.drafted ?? '', checked: head.checked ?? '', text, joins, margin: sections.margin, footnotes: sections.footnotes };
}

function distance<T>(a: T[], b: T[]): number {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
        prev = cur;
    }
    return prev[b.length];
}

/**
 * Lines as running text, spaces collapsed. With the transcription's line
 * ends, a word broken over a line is rejoined without its hyphen and a
 * hyphenated word keeps it; without them the lines are only put side by side.
 */
export function running(lines: string[], joins?: LineEnd[]): string {
    let out = '';
    lines.forEach((l, i) => {
        const end = joins?.[i] ?? null;
        out += end === 'break' ? l.replace(/-$/, '') : end === 'hyphen' ? l : `${l} `;
    });
    return out.replace(/\s+/g, ' ').trim();
}

/**
 * Character and word error rates of `hypothesis` against `reference`, both
 * running text: edits over the reference's length. A rate over an empty
 * reference is undefined (null); the edits still count what was invented.
 */
export function errorRates(reference: string, hypothesis: string): { cer: number | null; wer: number | null; charEdits: number; wordEdits: number; chars: number; words: number } {
    const rw = reference.split(' ').filter(Boolean), hw = hypothesis.split(' ').filter(Boolean);
    const charEdits = distance([...reference], [...hypothesis]), wordEdits = distance(rw, hw);
    return { cer: reference.length ? charEdits / reference.length : null, wer: rw.length ? wordEdits / rw.length : null, charEdits, wordEdits, chars: reference.length, words: rw.length };
}

/** Words of the page the recogniser did not read and words it read that the page does not print, order aside, over the page's words. */
export function wordBagError(reference: string[], read: string[]): { rate: number | null; missing: number; extra: number } {
    const count = (ws: string[]) => { const m = new Map<string, number>(); for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1); return m; };
    const r = count(reference), h = count(read);
    let missing = 0, extra = 0;
    for (const [w, n] of r) missing += Math.max(0, n - (h.get(w) ?? 0));
    for (const [w, n] of h) extra += Math.max(0, n - (r.get(w) ?? 0));
    return { rate: reference.length ? (missing + extra) / reference.length : null, missing, extra };
}

const likeness = (a: string, b: string) => { const n = Math.max(a.length, b.length); return n ? 1 - distance([...a], [...b]) / n : 1; };

/**
 * The printed lines matched in order to the lines read, each at most once
 * (sequence alignment, so a line printed twice is matched twice): the
 * index of the printed line each read line stands for, or -1.
 */
export function alignLines(reference: string[], read: string[], threshold = 0.6): number[] {
    const n = reference.length, m = read.length;
    const sim = reference.map((r) => read.map((x) => likeness(r, x)));
    const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
        const s = sim[i - 1][j - 1];
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s >= threshold ? dp[i - 1][j - 1] + s : -Infinity);
    }
    const of = new Array<number>(m).fill(-1);
    for (let i = n, j = m; i > 0 && j > 0;) {
        const s = sim[i - 1][j - 1];
        if (s >= threshold && dp[i][j] === dp[i - 1][j - 1] + s) { of[j - 1] = i - 1; i--; j--; }
        else if (dp[i][j] === dp[i - 1][j]) i--;
        else j--;
    }
    return of;
}

/** Printed lines no read line stands for (missing), and printed lines a second, unaligned read line also reads (twice). */
export function lineMatch(reference: string[], read: string[], threshold = 0.6): { missing: string[]; twice: string[] } {
    const of = alignLines(reference, read, threshold);
    const matched = new Set(of.filter((i) => i >= 0));
    const twice = new Set<number>();
    read.forEach((x, j) => {
        if (of[j] >= 0) return;
        reference.forEach((r, i) => { if (matched.has(i) && likeness(r, x) >= threshold) twice.add(i); });
    });
    return { missing: reference.filter((_, i) => !matched.has(i)), twice: reference.filter((_, i) => twice.has(i)) };
}

/**
 * The page as the complete reader leaves it: the lines the page reader gave
 * (lemma, heads), with those a chain read replaced by the chain's own text
 * that belongs on this leaf (tokens, cleaned excerpts, joined words, and
 * what the reader inserted, by where it was inserted). A line the chain read
 * is its own even when none of its characters survived, so text the reader
 * took out never comes back; every character of the chain belongs to one
 * page, so nothing it kept or added is lost between pages.
 */
type ChainText = { text: string; anchorAt(i: number): { leaf: number; y: number; margin?: boolean } | undefined; linesRead(): readonly { leaf: number; y: number; margin?: boolean }[] };
export function readerPageText(lines: { y: number; main: string }[], chains: ChainText[], leaf: number): string {
    const pieces = new Map<number, string>();
    const covered = new Set<number>();
    for (const c of chains) {
        for (const src of c.linesRead()) if (src.leaf === leaf && !src.margin) covered.add(src.y);
        const own = pageChars(c).filter((x) => x.leaf === leaf);
        if (own.length) pieces.set(own[0].y, (pieces.has(own[0].y) ? `${pieces.get(own[0].y)} ` : '') + own.map((x) => x.ch).join(''));
    }
    const out: string[] = [];
    for (const l of lines) {
        if (pieces.has(l.y)) out.push(pieces.get(l.y)!);
        else if (!covered.has(l.y)) out.push(l.main);
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Each character of a chain with the page it belongs to; one with no anchor goes with the next that has one. */
export function pageChars(c: ChainText): { ch: string; leaf: number; y: number }[] {
    const out: { ch: string; leaf: number; y: number }[] = [];
    let pending: string[] = [];
    for (let i = 0; i < c.text.length; i++) {
        const a = c.anchorAt(i);
        if (!a || a.margin) { if (!a) pending.push(c.text[i]); continue; }
        for (const ch of pending) out.push({ ch, leaf: a.leaf, y: a.y });
        pending = [];
        out.push({ ch: c.text[i], leaf: a.leaf, y: a.y });
    }
    const last = out.at(-1);
    if (last) for (const ch of pending) out.push({ ch, leaf: last.leaf, y: last.y });
    return out;
}

/**
 * Words printed on the page against words the recogniser saved, order aside:
 * both sides split at spaces with nothing rejoined, so a word the page breaks
 * over a line is two fragments on both. A discrepancy rate over a bag of
 * words, not a word error rate: a misread word counts once missing and once
 * invented.
 */
export function recogniserDiscrepancy(printed: string[], saved: string[]): { rate: number | null; missing: number; extra: number } {
    const words = (lines: string[]) => lines.join(' ').split(/\s+/).filter(Boolean);
    return wordBagError(words(printed), words(saved));
}

/**
 * Whether one change agrees with the printed page, judged in the printed
 * text aligned to the line it was made on (`region`): the changed
 * characters with a few either side, case kept, as the change leaves them
 * (`to`) or as the recogniser read them (`from`). Without an aligned region
 * the change cannot be judged.
 */
export function judge(change: { from: string; to: string }, region: string | undefined): 'agrees' | 'contradicts' | 'unclear' {
    if (!region) return 'unclear';
    const { from, to } = change;
    let p = 0;
    while (p < from.length && p < to.length && from[p] === to[p]) p++;
    let s = 0;
    while (s < from.length - p && s < to.length - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
    // The changed characters with up to six either side; a word boundary is asked for only where that runs to the end of what was logged
    const core = (t: string) => ({ piece: t.slice(Math.max(0, p - 6), t.length - Math.max(0, s - 6)), head: p <= 6, tail: s <= 6 });
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
    const text = norm(region);
    const found = ({ piece, head, tail }: { piece: string; head: boolean; tail: boolean }) => {
        const t = norm(piece);
        if (!t) return false;
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`${head && /^[A-Za-z]/.test(t) ? '(?<![A-Za-z])' : ''}${esc}${tail && /[A-Za-z]$/.test(t) ? '(?![A-Za-z])' : ''}`).test(text);
    };
    const made = found(core(to)), read = found(core(from));
    return made && !read ? 'agrees' : read && !made ? 'contradicts' : 'unclear';
}

/**
 * The printed text around the line a change was made on: the read line
 * nearest its height aligned to the printed line it stands for, with the
 * printed lines either side when the change carries words around it, since
 * they may run over a line break; a single word is judged in its own line.
 */
export function regionFor(y: number | undefined, read: { y: number; text: string }[], printed: string[], of: number[], wide = true, joins?: LineEnd[]): string | undefined {
    if (y === undefined || y < 0 || !read.length) return undefined;
    let best = 0;
    read.forEach((l, j) => { if (Math.abs(l.y - y) < Math.abs(read[best].y - y)) best = j; });
    const gaps = read.slice(1).map((l, j) => l.y - read[j].y).filter((g) => g > 0).sort((a, b) => a - b);
    const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : Infinity;
    if (Math.abs(read[best].y - y) > pitch * 0.6 || of[best] < 0) return undefined;
    const from = wide ? Math.max(0, of[best] - 1) : of[best], to = wide ? of[best] + 2 : of[best] + 1;
    return running(printed.slice(from, to), joins?.slice(from, to));
}
