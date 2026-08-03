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
 * `${book}:${chapter}:${ids.sort().join('+')}`.
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

// ─── Chapter-level computation (chunked + memoized) ───────────

export function chapterDivergenceKey(book: string, chapter: number, translationIds: TranslationId[]): string {
    return `${book}:${chapter}:${[...translationIds].sort().join('+')}`;
}

const cache = new Map<string, Map<string, Divergence>>();
const CACHE_LIMIT = 12; // chapters

const nextFrame = (): Promise<void> =>
    new Promise((resolve) =>
        typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0)
    );

/**
 * Compute divergence for every verse row of a chapter. `rows` maps each
 * translation to its rendering of one verse (missing translations simply
 * absent). Yields to the next frame whenever the current chunk has spent
 * its 12ms budget, so the main thread never misses a frame.
 */
export async function computeChapterDivergence(
    key: string,
    rows: Record<TranslationId, VerseRecord>[]
): Promise<Map<string, Divergence>> {
    const cached = cache.get(key);
    if (cached) return cached;

    const result = new Map<string, Divergence>();
    let sliceStart = performance.now();
    for (const row of rows) {
        const d = computeDivergence(row);
        if (d.verseId) result.set(d.verseId, d);
        if (performance.now() - sliceStart > 12) {
            await nextFrame();
            sliceStart = performance.now();
        }
    }

    cache.set(key, result);
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
