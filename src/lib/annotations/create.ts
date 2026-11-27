/**
 * New notes and theme tags for a verse selection. One record per
 * contiguous run, so selecting verses 10 and 14 never makes an
 * annotation that spans 11-13. The callers save the records; highlights
 * are planned by planHighlight in selection.ts because they also
 * recolour what is already there.
 */
import type { Annotation } from '@codex-scriptura/core';
import { toOsisId } from '@codex-scriptura/core';
import { getContiguousGroups } from '$lib/utils/verse-groups';
import { groupAnchors, type NoteAnchor } from '$lib/utils/scratchPad';

type Stamp = {
    now?: number;
    newId?: () => string;
};

const startOf = (r: NoteAnchor) => toOsisId({ book: r.book, chapter: r.chapter, verse: r.startVerse });
const endOf = (r: NoteAnchor) => toOsisId({ book: r.book, chapter: r.chapter, verse: r.endVerse });

function record(
    type: 'note' | 'theme',
    run: NoteAnchor,
    data: string,
    tags: readonly string[],
    { now, newId = () => crypto.randomUUID() }: { now: number; newId?: () => string },
): Annotation {
    return {
        id: newId(),
        type,
        book: run.book,
        verseStart: startOf(run),
        verseEnd: endOf(run),
        data,
        tags: [...tags],
        created: now,
        modified: now,
        synced: false,
    };
}

/** `verses` sorted ascending, as pane.selectedVerses always is. */
function runs(book: string, chapter: number, verses: readonly number[]): NoteAnchor[] {
    return getContiguousGroups([...verses]).map((g) => ({ book, chapter, startVerse: g[0], endVerse: g[g.length - 1] }));
}

/** Notes on the selected verses of one chapter. */
export function notesForSelection(opts: {
    book: string;
    chapter: number;
    verses: readonly number[];
    text: string;
    tags: readonly string[];
} & Stamp): Annotation[] {
    const stamp = { now: opts.now ?? Date.now(), newId: opts.newId };
    return runs(opts.book, opts.chapter, opts.verses).map((r) => record('note', r, opts.text, opts.tags, stamp));
}

/** Notes on explicit OSIS anchors, possibly across chapters (scratch pad "Convert to note"). */
export function notesForAnchors(opts: {
    anchors: readonly string[];
    text: string;
    tags: readonly string[];
} & Stamp): Annotation[] {
    const stamp = { now: opts.now ?? Date.now(), newId: opts.newId };
    return groupAnchors([...opts.anchors]).map((r) => record('note', r, opts.text, opts.tags, stamp));
}

/**
 * Theme tags on the selected verses. A run that already carries this
 * theme over exactly the same range is skipped, so an empty result means
 * everything was tagged already.
 */
export function themeTagsForSelection(opts: {
    book: string;
    chapter: number;
    verses: readonly number[];
    label: string;
    slug: string;
    existing: readonly Annotation[];
} & Stamp): Annotation[] {
    const stamp = { now: opts.now ?? Date.now(), newId: opts.newId };
    return runs(opts.book, opts.chapter, opts.verses)
        .filter((r) => !opts.existing.some((a) =>
            a.type === 'theme' && a.tags[0] === opts.slug &&
            a.verseStart === startOf(r) && a.verseEnd === endOf(r)
        ))
        .map((r) => record('theme', r, opts.label, [opts.slug], stamp));
}
