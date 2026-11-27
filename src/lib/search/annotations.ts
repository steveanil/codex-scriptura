/**
 * Annotations mode (issue #47) and the command palette's note lookup: the
 * one definition of "this annotation matches this query".
 *
 * A user has hundreds to a few thousand annotations, so this is a plain
 * in-memory scan with no index. Notes match on their body and tag names,
 * theme tags on their label, highlights on their tag names and on the
 * words of the verses they mark. Every query word must match (substring,
 * case-insensitive), a quoted phrase matches as a phrase, and a leading
 * `#tag` keeps only annotations carrying that tag.
 */

import type { Annotation } from '@codex-scriptura/core';
import { compareCanonical, escapeRegex, findBook, parseOsisId } from '@codex-scriptura/core';
import { db, getInstalledTranslationIds, getVerse, themeSlug } from '@codex-scriptura/db';
import { resolveActiveTranslation } from '$lib/utils/activeTranslation';
import type { Testament } from './fulltext';

export type AnnotationKind = 'note' | 'highlight' | 'theme';
export type AnnotationOrder = 'canonical' | 'recent';

export type AnnotationQuery = {
    /** The folded `#tag` restriction, or null. */
    tag: string | null;
    /** Folded words and phrases, every one required. */
    terms: string[];
};

/** The verses an annotation covers, read in the translation it is shown in. */
export type AnnotationVerses = { text: string; translationId: string };

export type AnnotationHit = {
    annotation: Annotation;
    kind: AnnotationKind;
    /** Verse text for highlights and theme tags; notes show their body instead. */
    verses: AnnotationVerses | null;
};

// The corpus writes U+2019 where keyboards type U+0027. Folding keeps the
// string length, so match offsets stay valid for highlighting.
function fold(s: string): string {
    return s.toLowerCase().replace(/[‘’ʼ]/g, "'");
}

export function isSearchableAnnotation(a: Annotation): a is Annotation & { type: AnnotationKind } {
    return a.type === 'note' || a.type === 'highlight' || a.type === 'theme';
}

export function parseAnnotationQuery(query: string): AnnotationQuery {
    let rest = query.trim();
    let tag: string | null = null;
    const tagMatch = /^#(\S+)\s*/.exec(rest);
    if (tagMatch) {
        tag = fold(tagMatch[1]);
        rest = rest.slice(tagMatch[0].length);
    }
    const terms: string[] = [];
    // An unclosed quote (mid-typing) still reads as a phrase
    for (const m of rest.matchAll(/"([^"]*)"?|(\S+)/g)) {
        const term = fold(m[1] ?? m[2]).trim().replace(/\s+/g, ' ');
        if (term) terms.push(term);
    }
    return { tag, terms };
}

// Theme tags store a slug in tags[0] while note tags keep the name as typed,
// so "#sermon-prep" finds "Sermon prep". Names the slug empties (non-Latin
// script) compare as typed.
function hasTag(a: Annotation, tag: string): boolean {
    const slug = themeSlug(tag);
    return a.tags.some((t) => fold(t) === tag || (slug !== '' && themeSlug(t) === slug));
}

/**
 * Whether one annotation matches. `verseText` is the text of the verses a
 * highlight marks; it is ignored for other types.
 */
export function annotationMatches(a: Annotation, q: AnnotationQuery, verseText = ''): boolean {
    if (!isSearchableAnnotation(a)) return false;
    if (q.tag && !hasTag(a, q.tag)) return false;
    if (q.terms.length === 0) return true;
    const fields = a.type === 'note' ? [a.data, ...a.tags]
        : a.type === 'theme' ? [a.data]
        : [...a.tags, verseText];
    const haystack = fold(fields.join('\n'));
    return q.terms.every((t) => haystack.includes(t));
}

/** A regex marking the query's words in a result, or null when there are none. */
export function annotationQueryPattern(q: AnnotationQuery): RegExp | null {
    if (q.terms.length === 0) return null;
    const alternatives = [...q.terms]
        .sort((a, b) => b.length - a.length)
        .map((t) => escapeRegex(t).replace(/'/g, "['‘’ʼ]").replace(/ /g, '\\s+'));
    return new RegExp(alternatives.join('|'), 'gi');
}

function anchor(a: Annotation) {
    return parseOsisId(a.verseStart) ?? { book: a.book, chapter: 0, verse: 0 };
}

/**
 * The annotations matching `query`, in Bible order (ties: most recent
 * first) or most recently modified first. `verses` holds the texts from
 * {@link loadAnnotationVerses}, keyed by annotation id.
 */
export function searchAnnotations(
    annotations: Annotation[],
    verses: Map<string, AnnotationVerses>,
    query: string,
    { testament = 'all', order = 'canonical' }: { testament?: Testament; order?: AnnotationOrder } = {},
): AnnotationHit[] {
    const q = parseAnnotationQuery(query);
    const hits: AnnotationHit[] = [];
    for (const a of annotations) {
        if (!isSearchableAnnotation(a)) continue;
        if (testament !== 'all' && findBook(a.book)?.testament !== testament) continue;
        const v = verses.get(a.id) ?? null;
        if (!annotationMatches(a, q, v?.text)) continue;
        hits.push({ annotation: a, kind: a.type, verses: a.type === 'note' ? null : v });
    }
    hits.sort(order === 'recent'
        ? (x, y) => y.annotation.modified - x.annotation.modified
        : (x, y) => compareCanonical(anchor(x.annotation), anchor(y.annotation)) || y.annotation.modified - x.annotation.modified);
    return hits;
}

/**
 * The verse text of every highlight and theme tag, read in one batch. A
 * highlight is read in the translation it was made in when that is still
 * installed, everything else in the reader's active translation. Ranges
 * are chapter-bound (the reader writes them per chapter); one that is not
 * reads its first verse only.
 */
export async function loadAnnotationVerses(
    annotations: Annotation[],
    activeTranslation: string | undefined,
): Promise<Map<string, AnnotationVerses>> {
    const installed = await getInstalledTranslationIds();
    const fallback = resolveActiveTranslation(activeTranslation, installed).id;
    const wanted = new Map<string, { translationId: string; ids: string[] }>();
    for (const a of annotations) {
        if (a.type !== 'highlight' && a.type !== 'theme') continue;
        const translationId = a.type === 'highlight' && a.translation && installed.includes(a.translation) ? a.translation : fallback;
        const start = parseOsisId(a.verseStart);
        if (!translationId || !start) continue;
        const end = parseOsisId(a.verseEnd);
        const last = end && end.book === start.book && end.chapter === start.chapter ? Math.max(end.verse, start.verse) : start.verse;
        const ids: string[] = [];
        for (let v = start.verse; v <= last; v++) ids.push(`${translationId}.${start.book}.${start.chapter}.${v}`);
        wanted.set(a.id, { translationId, ids });
    }

    const unique = [...new Set([...wanted.values()].flatMap((w) => w.ids))];
    const records = await db.verses.bulkGet(unique);
    const byId = new Map<string, { id: string; text: string }>();
    for (let i = 0; i < unique.length; i++) {
        const record = records[i];
        if (record) byId.set(unique[i], record);
    }
    // A verse inside a bridged record ("Neh.7.15-16" stored on verse 15) has no row of its own
    const missing = unique.filter((id) => !byId.has(id));
    for (const id of missing) {
        const dot = id.indexOf('.');
        const record = await getVerse(id.slice(0, dot), id.slice(dot + 1));
        if (record) byId.set(id, record);
    }

    const out = new Map<string, AnnotationVerses>();
    for (const [annotationId, { translationId, ids }] of wanted) {
        const seen = new Set<string>();
        const parts: string[] = [];
        for (const id of ids) {
            const record = byId.get(id);
            if (!record || seen.has(record.id)) continue;
            seen.add(record.id);
            parts.push(record.text);
        }
        out.set(annotationId, { text: parts.join(' '), translationId });
    }
    return out;
}
