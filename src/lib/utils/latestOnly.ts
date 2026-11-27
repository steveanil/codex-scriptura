/** Lets only the newest of several overlapping async runs commit its result. */
export class LatestOnly {
    #generation = 0;

    /** Start a run. The returned check stays true until a newer run begins or cancel() is called. */
    begin(): () => boolean {
        const gen = ++this.#generation;
        return () => gen === this.#generation;
    }

    /** A check tied to the run in progress, without starting a new one. */
    current(): () => boolean {
        const gen = this.#generation;
        return () => gen === this.#generation;
    }

    /** Invalidate every outstanding check. */
    cancel(): void {
        this.#generation++;
    }
}
