/**
 * What the verse toolbar's selection sits on, and what a highlight swatch
 * does to it (issue #322).
 */
import type { Annotation } from '@codex-scriptura/core';
import { isVerseInAnnotation } from '$lib/utils/verse-render';
import { getContiguousGroups } from '$lib/utils/verse-groups';
import { editAnnotation } from './edit';

/** Annotations of one type that cover at least one of the verses. */
export function coveringAnnotations(
    chapter: number,
    verses: readonly number[],
    annotations: readonly Annotation[],
    type: Annotation['type'],
): Annotation[] {
    return annotations.filter((a) => a.type === type && verses.some((v) => isVerseInAnnotation(chapter, v, a)));
}

/**
 * Records to save when a swatch is chosen. Highlights the selection
 * already sits on are recoloured in place (same id); only selected
 * verses no highlight covers get a new one, one per contiguous run.
 * `visible` must be the highlights the pane renders, so another
 * translation's highlight is never touched.
 */
export function planHighlight(opts: {
    book: string;
    chapter: number;
    verses: readonly number[];
    color: string;
    translation: string;
    visible: readonly Annotation[];
    now?: number;
}): Annotation[] {
    const { book, chapter, verses, color, translation, visible, now = Date.now() } = opts;
    const covering = coveringAnnotations(chapter, verses, visible, 'highlight');
    const out: Annotation[] = [];
    for (const h of covering) {
        const r = editAnnotation(h, { color });
        if (r.ok && r.changed) out.push(r.annotation);
    }
    const uncovered = verses.filter((v) => !covering.some((h) => isVerseInAnnotation(chapter, v, h)));
    for (const group of getContiguousGroups([...uncovered])) {
        out.push({
            id: crypto.randomUUID(),
            type: 'highlight',
            book,
            verseStart: `${book}.${chapter}.${group[0]}`,
            verseEnd: `${book}.${chapter}.${group[group.length - 1]}`,
            data: '',
            color,
            translation,
            tags: [],
            created: now,
            modified: now,
            synced: false,
        });
    }
    return out;
}
