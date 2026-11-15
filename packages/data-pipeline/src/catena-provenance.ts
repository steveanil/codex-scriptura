/**
 * Per-excerpt provenance for the Catena Aurea (issue #85): where each
 * excerpt was read, and what is known of its margin citation. Nothing is
 * decided here; the status is derived from records that already exist:
 *
 *   the page-review log      a whole-page or margin-citations reading of every leaf the excerpt stands on
 *   citation corrections     a citation set from the page image
 *   open questions           a question bound to the excerpt, which overrides any check
 *
 * An excerpt with a citation and none of these is the OCR's reading, unverified.
 */

import { commentaryBlockKeys, type CommentaryExcerptMeta, type RawCommentaryEntry } from '@codex-scriptura/core';
import type { PageReview } from './catena-review-queue.js';

export type CitationCorrectionRecord = { item: string; chapter: number; verseStart: number; verseEnd: number; occurrence?: number; excerpt: number; citation?: string; leaf?: number; note?: string; reviewer?: 'ai' | 'human' };
/** `excerpt` is text found once in the excerpt the question is about; `concerns` says what of it is in doubt. */
export type QuestionRecord = { kind: string; status: string; issue?: number; item: string; leaf: number; entry: string; question: string; excerpt?: string; concerns?: 'citation' | 'attribution' | 'text'; /** The gate finding the question stands for, when it defers one. */ finding?: string };
export type ProvenanceRecords = { reviews: PageReview[]; citationCorrections: CitationCorrectionRecord[]; questions: QuestionRecord[] };
export type TracedEntry = RawCommentaryEntry & { item: string; excerptLeaves: number[] };

const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
// A reviewer is a person unless the log says the page was read by an AI model
const reviewerKind = (name: string): 'ai' | 'human' => (/\bAI\b/.test(name) ? 'ai' : 'human');

/** The excerpt records of every entry, by entry id. Throws on a question that names an excerpt it cannot find. */
export function excerptProvenance(entries: TracedEntry[], records: ProvenanceRecords, opts: { partial?: boolean } = {}): Map<string, CommentaryExcerptMeta[]> {
    // The margin of a leaf was read when a whole-page or a margin-citations review of it is logged; the latest such reading stands for it
    const margin = new Map<string, { reviewed: string; reviewer: 'ai' | 'human' }>();
    for (const r of records.reviews) {
        if (r.scope !== 'whole page' && r.scope !== 'margin citations') continue;
        const key = `${r.item}#${r.leaf}`, was = margin.get(key);
        if (!was || r.reviewed > was.reviewed) margin.set(key, { reviewed: r.reviewed, reviewer: reviewerKind(r.reviewer) });
    }
    const corrected = new Map(records.citationCorrections.filter((c) => c.citation !== undefined).map((c) => [`${c.item}|${c.chapter}|${c.verseStart}|${c.verseEnd}|${c.occurrence ?? 1}|${c.excerpt}`, c]));
    const open = records.questions.filter((q) => q.status === 'open' && q.excerpt);
    const ids = new Set(entries.map((e) => e.id));
    for (const q of open) if (!ids.has(q.entry) && !opts.partial) throw new Error(`[catena] an open question names an excerpt of ${q.entry}, which is not an entry of the corpus`);
    const seenRange = new Map<string, number>();
    const out = new Map<string, CommentaryExcerptMeta[]>();
    for (const e of entries) {
        const range = `${e.item}|${e.startRef}|${e.endRef}`;
        const occurrence = (seenRange.get(range) ?? 0) + 1;
        seenRange.set(range, occurrence);
        const [, chapter, verseStart] = e.startRef.split('.').map(Number), verseEnd = Number(e.endRef.split('.')[2]);
        const keys = commentaryBlockKeys(e.content);
        const paragraphs = e.content.split(/\n[ \t]*\n+/).filter((p) => p.trim() !== '');
        if (paragraphs.length !== keys.length) throw new Error(`[catena] ${e.id}: the content does not divide into the blocks its keys were made for`);
        const excerpts = paragraphs.map((text, at) => ({ text, key: keys[at] })).filter((p) => p.text.startsWith('**'));
        if (excerpts.length !== e.excerptLeaves.length) throw new Error(`[catena] ${e.id}: ${excerpts.length} excerpts in the content, ${e.excerptLeaves.length} traced to a leaf`);
        const questions = open.filter((q) => q.entry === e.id);
        const asked = new Map<number, QuestionRecord>();
        for (const q of questions) {
            const hits = excerpts.map((x, i) => (unescape(x.text).includes(q.excerpt!) ? i : -1)).filter((i) => i >= 0);
            if (hits.length !== 1) throw new Error(`[catena] the open question on leaf ${q.leaf} of ${q.item} names an excerpt of ${e.id} by "${q.excerpt}", which is in ${hits.length} excerpts`);
            asked.set(hits[0], q);
        }
        out.set(e.id, excerpts.map((x, i): CommentaryExcerptMeta => {
            const leaf = e.excerptLeaves[i];
            const meta: CommentaryExcerptMeta = { key: x.key, leaf };
            const cited = /^\*\*[^*]*\*\* \(\*/.test(x.text);
            const q = asked.get(i);
            if (q) { meta.question = q.question; if (q.issue !== undefined) meta.issue = q.issue; }
            // A question that stands for a gate finding asks whether words are missing: the reader is told, and given every page
            if (q?.finding) {
                meta.text = 'possibly-incomplete';
                const end = e.excerptLeaves[i + 1] ?? leaf;
                if (end > leaf) meta.leafEnd = end;
            }
            if (!cited) return meta;
            if (q && q.concerns !== 'text') return { ...meta, citation: 'unresolved' };
            // Checked by a correction made from the page image, or by a reading of the margin of every leaf it stands on
            const fix = corrected.get(`${e.item}|${chapter}|${verseStart}|${verseEnd}|${occurrence}|${i + 1}`);
            const last = e.excerptLeaves[i + 1] ?? e.source?.leafEnd ?? leaf;
            const read = Array.from({ length: Math.max(1, last - leaf + 1) }, (_, k) => margin.get(`${e.item}#${leaf + k}`));
            if (read.every((r) => r)) {
                const all = read as { reviewed: string; reviewer: 'ai' | 'human' }[];
                return { ...meta, citation: 'checked', reviewed: all.map((r) => r.reviewed).sort().at(-1)!, reviewer: all.every((r) => r.reviewer === 'human') ? 'human' : 'ai' };
            }
            if (fix) {
                const on = margin.get(`${e.item}#${fix.leaf ?? leaf}`);
                const reviewed = on?.reviewed ?? /\d{4}-\d{2}-\d{2}/.exec(fix.note ?? '')?.[0];
                // Every citation correction so far was read by an AI model; a record says so itself when a person read it
                return { ...meta, citation: 'checked', ...(reviewed ? { reviewed } : {}), reviewer: fix.reviewer ?? 'ai' };
            }
            return { ...meta, citation: 'unverified' };
        }));
    }
    return out;
}
