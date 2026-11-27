/** A place in scripture by canonical reference. Which translation renders it is the pane's business (D17). */
export type PassageTarget = { book: string; chapter: number; verse?: number | string };

export type NavigationIntent =
    | {
          target: PassageTarget;
          /** Pane index, or 'new' to open the passage in a split pane. Defaults to the lead pane (0). */
          pane?: number | 'new';
          /** 'open' (default) is a move the reader made. 'replace' follows the URL: nothing is recorded. */
          mode?: 'open' | 'replace';
      }
    | { mode: 'return' }; // one step back through history

/**
 * The passage a reader URL asks for: `?book=&chapter=` plus an optional
 * `#verse-N`, with an absent param taken from `current`. Null when the URL
 * names neither a book nor a chapter.
 */
export function targetFromUrl(url: URL, current: { book: string; chapter: number }): PassageTarget | null {
    const book = url.searchParams.get('book');
    const chapter = url.searchParams.get('chapter');
    if (!book && !chapter) return null;
    const target: PassageTarget = {
        book: book || current.book,
        chapter: chapter ? parseInt(chapter, 10) || 1 : current.chapter,
    };
    if (url.hash.startsWith('#verse-')) target.verse = url.hash.slice('#verse-'.length);
    return target;
}
