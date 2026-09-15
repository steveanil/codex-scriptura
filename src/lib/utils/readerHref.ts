/**
 * Canonical deep link into the reader. Previously built by hand at 6+
 * sites (issue #174) - the `#verse-N` anchor format also has to match
 * the reader's scroll-target ids, so one builder keeps them in lockstep.
 */
export function readerHref(book: string, chapter: number | string, verse?: number | string): string {
    const anchor = verse !== undefined ? `#verse-${verse}` : '';
    return `/read?book=${book}&chapter=${chapter}${anchor}`;
}
