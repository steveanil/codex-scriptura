/**
 * Scoring for the Catena Aurea OCR benchmark (issue #85, benchmark/catena):
 * transcriptions read from the page images, against which the recogniser's
 * text, the reader's page text and every change the reader logged on the
 * page are measured.
 */

export type Transcription = { item: string; leaf: number; drafted: string; checked: string; text: string[]; margin: string[]; footnotes: string[] };

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
    return { item: head.item ?? '', leaf: Number(head.leaf), drafted: head.drafted ?? '', checked: head.checked ?? '', text: sections.text, margin: sections.margin, footnotes: sections.footnotes };
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

/** Lines as running text: a word broken at a line's end rejoined, as the reader joins it, and spaces collapsed. */
export function running(lines: string[]): string {
    return lines.join('\n').replace(/-\n(?=[a-z])/g, '').replace(/\s+/g, ' ').trim();
}

/** Character and word error rates of `hypothesis` against `reference`, both running text. */
export function errorRates(reference: string, hypothesis: string): { cer: number; wer: number; chars: number; words: number } {
    const rw = reference.split(' ').filter(Boolean), hw = hypothesis.split(' ').filter(Boolean);
    return { cer: reference.length ? distance([...reference], [...hypothesis]) / reference.length : 0, wer: rw.length ? distance(rw, hw) / rw.length : 0, chars: reference.length, words: rw.length };
}

const likeness = (a: string, b: string) => { const n = Math.max(a.length, b.length); return n ? 1 - distance([...a], [...b]) / n : 1; };

/** Printed lines no OCR line reads (missing), and printed lines two OCR lines read (twice). */
export function lineMatch(reference: string[], read: string[], threshold = 0.6): { missing: string[]; twice: string[] } {
    const hits = reference.map(() => 0);
    for (const r of read) {
        let best = -1, score = threshold;
        reference.forEach((p, i) => { const s = likeness(p, r); if (s >= score) { best = i; score = s; } });
        if (best >= 0) hits[best]++;
    }
    return { missing: reference.filter((_, i) => hits[i] === 0), twice: reference.filter((_, i) => hits[i] > 1) };
}

/**
 * Whether a change the reader logged agrees with the printed page: the
 * changed characters with a few either side, as the change leaves them
 * (`to`) or as the recogniser read them (`from`), looked for in the
 * page's running text, spacing and case aside.
 */
export function judge(change: { from: string; to: string }, page: string): 'agrees' | 'contradicts' | 'unclear' {
    const { from, to } = change;
    let p = 0;
    while (p < from.length && p < to.length && from[p] === to[p]) p++;
    let s = 0;
    while (s < from.length - p && s < to.length - p && from[from.length - 1 - s] === to[to.length - 1 - s]) s++;
    const core = (t: string) => t.slice(Math.max(0, p - 6), t.length - Math.max(0, s - 6));
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
    const text = norm(page);
    const made = text.includes(norm(core(to))), read = text.includes(norm(core(from)));
    return made && !read ? 'agrees' : read && !made ? 'contradicts' : 'unclear';
}
