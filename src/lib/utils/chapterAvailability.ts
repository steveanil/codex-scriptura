/**
 * Why a reader pane has no verses to show (issue #400). A deep link - a
 * topic reference, a cross-reference, a theme thread - can land on a book
 * the active translation never had (OEB is a partial canon), and that is
 * an upstream fact, not a broken download. The reader tells those apart.
 */

export type EmptyChapterReason =
    /** The translation has no verses at all on this device: never downloaded, removed, or an interrupted replacement. */
    | 'translation-missing'
    /** The translation is installed but does not include this book. */
    | 'book-not-covered'
    /** The book is there, this chapter is not: damaged or incomplete data. */
    | 'chapter-missing';

/** `availableBooks` is the translation's book list on this device (getBookList). */
export function emptyChapterReason(availableBooks: readonly string[], book: string): EmptyChapterReason {
    if (availableBooks.length === 0) return 'translation-missing';
    if (!availableBooks.includes(book)) return 'book-not-covered';
    return 'chapter-missing';
}
