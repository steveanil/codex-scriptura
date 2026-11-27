/**
 * Verse-anchored sync scroll. When two panes show the same chapter,
 * syncing by fraction drifts (translations wrap differently), so panes
 * exchange "verse N, this far into it" anchors instead. The maths works
 * on viewport rectangles and scroll metrics; ReaderPane reads those from
 * the DOM.
 */

export type ScrollAnchor = { verse: number; progress: number };

/** A rendered verse's box in viewport coordinates. `verse` is NaN when the element's number did not parse. */
export type VerseBox = { verse: number; top: number; bottom: number; height: number };

/**
 * The first verse whose box reaches below the container's top edge, and
 * how far into it that edge sits (0-1). `verses` in document order; it is
 * read only up to the first hit, so a lazy iterable avoids measuring the
 * rest.
 */
export function anchorAtTop(containerTop: number, verses: Iterable<VerseBox>): ScrollAnchor | null {
    for (const r of verses) {
        if (r.height <= 0 || r.bottom <= containerTop + 1) continue;
        if (isNaN(r.verse)) return null;
        return { verse: r.verse, progress: Math.max(0, (containerTop - r.top) / r.height) };
    }
    return null;
}

/**
 * The scrollTop that puts `progress` of the verse at the container's top.
 * Clamped to the scrollable range: an out-of-range assignment gets clamped
 * by the browser without firing a scroll event, which would leave the
 * pane's scroll-event suppression armed to eat the next real user scroll.
 */
export function scrollTopForAnchor(m: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    containerTop: number;
    verseTop: number;
    verseHeight: number;
    progress: number;
}): number {
    return Math.max(
        0,
        Math.min(
            m.scrollTop + (m.verseTop - m.containerTop) + m.progress * m.verseHeight,
            m.scrollHeight - m.clientHeight
        )
    );
}
