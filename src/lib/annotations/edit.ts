/**
 * Editing an annotation in place (issue #322). Every edit, from the
 * sidebar or the verse toolbar, goes through editAnnotation so the rules
 * live in one place and the UI never assembles an updated record itself.
 * The id, type, created time and a highlight's translation never change;
 * `modified` is stamped by saveAnnotation, not here.
 */
import type { Annotation } from '@codex-scriptura/core';
import { findBook, parseOsisId } from '@codex-scriptura/core';
import { normalizeTagName } from '@codex-scriptura/db';

/** The fields an edit may change. Which ones apply depends on the type. */
export type AnnotationPatch = {
    /** Note text. */
    body?: string;
    /** Note tags; normalised on the way in. */
    tags?: string[];
    /** Highlight colour, as the toolbar stores it. */
    color?: string;
    /** New verse range as OSIS ids, inside the annotation's book. */
    range?: { start: string; end: string };
};

/** Last verse of each chapter of the annotation's book (db getLastVerses). */
export type LastVerses = Record<number, number>;

export type EditResult =
    | { ok: true; annotation: Annotation; changed: boolean }
    | { ok: false; error: string };

const EDITABLE: Partial<Record<Annotation['type'], readonly (keyof AnnotationPatch)[]>> = {
    note: ['body', 'tags', 'range'],
    highlight: ['color', 'range'],
};

const NOT_FOR_TYPE: Record<keyof AnnotationPatch, string> = {
    body: 'Only notes have text.',
    tags: 'Only notes carry tags.',
    color: 'Only highlights have a colour.',
    range: 'This annotation keeps its verses.',
};

/** Each name in the registry's spelling (normalizeTagName), without blanks or repeats, in first-seen order. */
export function normalizeTags(tags: readonly string[]): string[] {
    const out: string[] = [];
    for (const t of tags) {
        const n = normalizeTagName(t);
        if (n && !out.includes(n)) out.push(n);
    }
    return out;
}

/** Why a note with this text and these tags can't be saved, or null. Shared with the create path. */
export function noteContentError(body: string, tags: readonly string[]): string | null {
    return body.trim() || normalizeTags(tags).length > 0 ? null : 'Write something or add a tag.';
}

export function editAnnotation(ann: Annotation, patch: AnnotationPatch, lastVerses?: LastVerses | null): EditResult {
    const allowed = EDITABLE[ann.type];
    if (!allowed) {
        return fail(ann.type === 'theme'
            ? 'Theme tags keep their verses. Remove this one and tag the new verses instead.'
            : 'This annotation can not be edited.');
    }
    for (const key of Object.keys(NOT_FOR_TYPE) as (keyof AnnotationPatch)[]) {
        if (patch[key] !== undefined && !allowed.includes(key)) return fail(NOT_FOR_TYPE[key]);
    }

    const next: Annotation = { ...ann, tags: [...ann.tags] };

    if (patch.body !== undefined) next.data = patch.body;
    if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
    if (ann.type === 'note') {
        const err = noteContentError(next.data, next.tags);
        if (err) return fail(err);
    }

    if (patch.color !== undefined) {
        const color = patch.color.trim();
        if (!color) return fail('Pick a colour.');
        next.color = color;
    }

    if (patch.range) {
        const range = checkRange(ann.book, patch.range, lastVerses);
        if (typeof range === 'string') return fail(range);
        next.book = range.book;
        next.verseStart = range.start;
        next.verseEnd = range.end;
    }

    const changed =
        next.data !== ann.data ||
        next.color !== ann.color ||
        next.verseStart !== ann.verseStart ||
        next.verseEnd !== ann.verseEnd ||
        next.tags.join('\n') !== ann.tags.join('\n');
    return { ok: true, annotation: next, changed };
}

function checkRange(
    book: string,
    range: { start: string; end: string },
    lastVerses: LastVerses | null | undefined,
): { book: string; start: string; end: string } | string {
    const name = findBook(book)?.name ?? book;
    const s = parseOsisId(range.start);
    const e = parseOsisId(range.end);
    if (!s || !e) return 'Pick a start and an end verse.';
    if (s.book !== book || e.book !== book) return `The verses have to stay in ${name}.`;
    if (!lastVerses) return `Verse numbers for ${name} are not loaded yet.`;
    for (const p of [s, e]) {
        const last = lastVerses[p.chapter];
        if (!last) return `${name} has no chapter ${p.chapter}.`;
        if (p.verse < 1 || p.verse > last) return `${name} ${p.chapter} has no verse ${p.verse}.`;
    }
    if (s.chapter > e.chapter || (s.chapter === e.chapter && s.verse > e.verse)) {
        return 'The start verse comes after the end verse.';
    }
    return { book, start: `${book}.${s.chapter}.${s.verse}`, end: `${book}.${e.chapter}.${e.verse}` };
}

function fail(error: string): EditResult {
    return { ok: false, error };
}
