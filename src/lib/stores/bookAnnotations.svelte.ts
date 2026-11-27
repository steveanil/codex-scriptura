import type { Annotation } from '@codex-scriptura/core';
import { observeAnnotationsForBook } from '@codex-scriptura/db';

/**
 * A live view of one book's annotations (issue #31). One liveQuery keyed on
 * the followed book pushes into `items` on every annotations-table change,
 * same tab or another, so mutation sites never reload manually.
 */
export class BookAnnotations {
    items = $state<Annotation[]>([]);

    #sub: { unsubscribe(): void } | null = null;
    #book: string | null = null;
    #resolveFirstEmission: (() => void) | null = null;
    #disposed = false;

    /**
     * (Re)subscribe when the book changes; a no-op while it hasn't, since
     * the subscription keeps `items` current on its own. Resolves once the
     * first result set for the new book has arrived, so a chapter load can
     * keep its all-data-ready loading gate.
     */
    follow(book: string): Promise<void> {
        if (this.#disposed || this.#book === book) return Promise.resolve();
        this.#book = book;
        this.#sub?.unsubscribe();
        // A pending first-emission promise from a superseded book must not
        // dangle - resolve it; the caller's own race guard takes over.
        this.#resolveFirstEmission?.();
        return new Promise((resolve) => {
            this.#resolveFirstEmission = resolve;
            this.#sub = observeAnnotationsForBook(book).subscribe({
                next: (anns) => {
                    this.items = anns;
                    this.#resolveFirstEmission?.();
                    this.#resolveFirstEmission = null;
                },
                error: () => {
                    this.#resolveFirstEmission?.();
                    this.#resolveFirstEmission = null;
                },
            });
        });
    }

    /** Tear the subscription down for good: `follow` never subscribes again (issue #186). */
    dispose(): void {
        this.#disposed = true;
        this.#sub?.unsubscribe();
        this.#sub = null;
        this.#book = null;
        this.#resolveFirstEmission?.();
        this.#resolveFirstEmission = null;
    }
}
