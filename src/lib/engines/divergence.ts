/**
 * Translation-divergence engine for the aligned parallel reader (#24).
 *
 * Token-level comparison across N renderings of the same verse: a token
 * counts as divergent for a translation when its normalized form appears
 * in no more than half of the open translations - i.e. it is absent from
 * the majority rendering. Char spans point back into the ORIGINAL text so
 * the grid can shade exactly the words that differ.
 *
 * Chapter computation is chunked across frames (there is no worker
 * infrastructure in the app yet - the 12ms yield budget keeps a long
 * chapter from ever blocking a frame) and memoized per
 * `${book}:${chapter}:${ids.sort().join('+')}` plus a content signature,
 * so re-imported text never serves stale spans.
 *
 * The row/card model shared by the workspace and the Divergence Map
 * (buildChapterRows / buildDivergenceCards) lives here too, as pure
 * functions - components add display concerns (colors, abbreviations)
 * on top.
 */

import type { VerseRecord } from '@codex-scriptura/core';

export type TranslationId = string;
export type Severity = 'low' | 'med' | 'high';

export type Divergence = {
    verseId: string;
    severity: Severity;
    /** Char ranges [start, end) into each translation's original verse text. */
    spans: Record<TranslationId, [number, number][]>;
};

/**
 * Divergent-token ratio boundaries. Tuned on KJV/ASV/WEB chapters: routine
 * archaism drift (thee/you, hath/has) keeps a typical verse under ~0.35,
 * while genuinely contested renderings push past half their tokens.
 */
export const SEVERITY_THRESHOLDS = { med: 0.35, high: 0.55 };

type Token = { norm: string; start: number; end: number };

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        // Normalize: lowercase, strip punctuation (collapse-whitespace is
        // implicit in \S+ tokenization).
        const norm = m[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        if (norm.length === 0) continue; // pure punctuation token
        tokens.push({ norm, start: m.index, end: m.index + m[0].length });
    }
    return tokens;
}

/** Merge per-token ranges of consecutive divergent tokens into spans. */
function mergeSpans(tokens: Token[], divergent: boolean[]): [number, number][] {
    const spans: [number, number][] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (!divergent[i]) continue;
        const last = spans[spans.length - 1];
        // Contiguous divergent tokens fuse into one span (the gap is whitespace)
        if (last && divergent[i - 1] && tokens[i - 1].end === last[1]) {
            last[1] = tokens[i].end;
        } else {
            spans.push([tokens[i].start, tokens[i].end]);
        }
    }
    return spans;
}

export function computeDivergence(verses: Record<TranslationId, VerseRecord>): Divergence {
    const ids = Object.keys(verses);
    const verseId = ids.length > 0 ? verses[ids[0]].osisId : '';
    const empty: Divergence = { verseId, severity: 'low', spans: {} };
    if (ids.length < 2) return empty;

    const tokenized = new Map<TranslationId, Token[]>();
    const vocab = new Map<TranslationId, Set<string>>();
    for (const id of ids) {
        const tokens = tokenize(verses[id].text);
        tokenized.set(id, tokens);
        vocab.set(id, new Set(tokens.map((t) => t.norm)));
    }

    // A token is shared when a strict majority of translations render it
    const majority = ids.length / 2;
    let worstRatio = 0;
    const spans: Record<TranslationId, [number, number][]> = {};
    for (const id of ids) {
        const tokens = tokenized.get(id)!;
        const divergent = tokens.map((t) => {
            let count = 0;
            for (const otherVocab of vocab.values()) {
                if (otherVocab.has(t.norm)) count++;
            }
            return count <= majority;
        });
        const divergentCount = divergent.filter(Boolean).length;
        if (tokens.length > 0) worstRatio = Math.max(worstRatio, divergentCount / tokens.length);
        const merged = mergeSpans(tokens, divergent);
        if (merged.length > 0) spans[id] = merged;
    }

    const severity: Severity =
        worstRatio >= SEVERITY_THRESHOLDS.high ? 'high'
        : worstRatio >= SEVERITY_THRESHOLDS.med ? 'med'
        : 'low';
    return { verseId, severity, spans };
}

/** True when the verse actually diverges somewhere (spans exist). */
export function hasDivergence(d: Divergence): boolean {
    return Object.keys(d.spans).length > 0;
}

// ─── Chapter row model (shared by workspace + Divergence Map) ─

export type ChapterSource = { translation: TranslationId; verses: VerseRecord[] };
export type ChapterCell = { translation: TranslationId; verse?: VerseRecord };
export type ChapterRow = {
    num: number;
    osisId: string;
    /** One cell per source, in source order; verse absent where a translation lacks it. */
    cells: ChapterCell[];
};

/**
 * Align N translations of one chapter into verse rows: the union of verse
 * numbers in canonical order, one cell per source. The row model both the
 * divergence computation and the Divergence Map consume.
 */
export function buildChapterRows(sources: ChapterSource[]): ChapterRow[] {
    const maps = sources.map((s) => new Map(s.verses.map((v) => [v.verse, v])));
    const nums = new Set<number>();
    for (const s of sources) for (const v of s.verses) nums.add(v.verse);
    return [...nums].sort((a, b) => a - b).map((num) => {
        const cells = sources.map((s, i) => ({ translation: s.translation, verse: maps[i].get(num) }));
        return { num, osisId: cells.find((c) => c.verse)?.verse?.osisId ?? '', cells };
    });
}

export type DivergenceCard = {
    osisId: string;
    num: number;
    severity: Severity;
    renders: { translation: TranslationId; text: string }[];
};

/**
 * The Divergence Map's card list: med/high rows only (low stays signal,
 * not noise), highest severity first, then canonical order. Pure data -
 * the component layers colors and abbreviations on top.
 */
export function buildDivergenceCards(rows: ChapterRow[], divergence: Map<string, Divergence>): DivergenceCard[] {
    const list: DivergenceCard[] = [];
    for (const row of rows) {
        const d = divergence.get(row.osisId);
        if (!d || !hasDivergence(d) || d.severity === 'low') continue;
        list.push({
            osisId: row.osisId,
            num: row.num,
            severity: d.severity,
            renders: row.cells
                .filter((c) => c.verse?.text)
                .map((c) => ({ translation: c.translation, text: c.verse!.text })),
        });
    }
    const rank: Record<Severity, number> = { high: 0, med: 1, low: 2 };
    return list.sort((a, b) => rank[a.severity] - rank[b.severity] || a.num - b.num);
}

// ─── Chapter-level computation (chunked + memoized) ───────────

export function chapterDivergenceKey(book: string, chapter: number, translationIds: TranslationId[]): string {
    return `${book}:${chapter}:${[...translationIds].sort().join('+')}`;
}

/**
 * Cheap rolling hash over the row texts. Folded into the memo key so the
 * location key alone can never serve stale spans after a translation's
 * text changes (e.g. a re-import).
 */
function contentSignature(rows: ChapterRow[]): string {
    let h = 0;
    let n = 0;
    for (const row of rows) {
        for (const cell of row.cells) {
            if (!cell.verse) continue;
            n++;
            const t = cell.verse.text;
            for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
        }
    }
    return `${n}:${h.toString(36)}`;
}

const cache = new Map<string, Map<string, Divergence>>();
const CACHE_LIMIT = 12; // chapters

const nextFrame = (): Promise<void> =>
    new Promise((resolve) =>
        typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0)
    );

function rowRecord(row: ChapterRow): Record<TranslationId, VerseRecord> {
    const rec: Record<TranslationId, VerseRecord> = {};
    for (const cell of row.cells) {
        if (cell.verse && !(cell.translation in rec)) rec[cell.translation] = cell.verse;
    }
    return rec;
}

/**
 * Compute divergence for every verse row of a chapter. Yields to the next
 * frame whenever the current chunk has spent its 12ms budget, so the main
 * thread never misses a frame.
 */
export async function computeChapterDivergence(
    key: string,
    rows: ChapterRow[]
): Promise<Map<string, Divergence>> {
    const cacheKey = `${key}|${contentSignature(rows)}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const result = new Map<string, Divergence>();
    let sliceStart = performance.now();
    for (const row of rows) {
        const d = computeDivergence(rowRecord(row));
        if (row.osisId) result.set(row.osisId, d);
        if (performance.now() - sliceStart > 12) {
            await nextFrame();
            sliceStart = performance.now();
        }
    }

    cache.set(cacheKey, result);
    // Bounded memo: evict the oldest chapters
    if (cache.size > CACHE_LIMIT) {
        for (const k of cache.keys()) {
            if (cache.size <= CACHE_LIMIT) break;
            cache.delete(k);
        }
    }
    return result;
}

/** Test hook: drop the chapter memo. */
export function clearDivergenceCache(): void {
    cache.clear();
}
