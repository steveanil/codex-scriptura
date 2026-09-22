/**
 * The search page's holdings of full-text indexes (issue #364): which of
 * the selected translations have an index ready, which are still loading
 * and which failed. The index manager (issue #164) owns the indexes; this
 * only tracks the page's view of them so pills and placeholders can react,
 * and releases what the page stops selecting.
 */

import { SvelteMap } from 'svelte/reactivity';
import { getOrBuildIndex, releaseIndex, type SearchIndex } from './index-manager';

type Entry = { index: SearchIndex | null; building: boolean; ready: boolean; failed: boolean };

export class SearchIndexSet {
    #entries = new SvelteMap<string, Entry>();

    /** The ready translations, as one string, so an effect can re-run only when that set changes. */
    readyKey = $derived(
        [...this.#entries].filter(([, e]) => e.ready).map(([id]) => id).sort().join(),
    );

    /** Hold exactly these translations: start loading the new ones, release the rest. */
    sync(translationIds: string[]): void {
        for (const id of [...this.#entries.keys()]) {
            if (!translationIds.includes(id)) this.release(id);
        }
        for (const id of translationIds) void this.ensure(id);
    }

    /** Load a translation's index unless it is ready or on its way. A failed entry is neither, so this retries it (issue #158). */
    async ensure(translationId: string): Promise<void> {
        const entry = this.#entries.get(translationId);
        if (entry?.ready || entry?.building) return;

        this.#entries.set(translationId, { index: null, building: true, ready: false, failed: false });
        try {
            const index = await getOrBuildIndex(translationId);
            // Released while it loaded: do not resurrect it
            if (!this.#entries.has(translationId)) {
                releaseIndex(translationId);
                return;
            }
            this.#entries.set(translationId, { index, building: false, ready: true, failed: false });
        } catch (err) {
            console.error(`Search index build failed for ${translationId}`, err);
            this.#entries.set(translationId, { index: null, building: false, ready: false, failed: true });
        }
    }

    release(translationId: string): void {
        this.#entries.delete(translationId);
        releaseIndex(translationId);
    }

    releaseAll(): void {
        for (const id of [...this.#entries.keys()]) this.release(id);
    }

    isReady(translationId: string): boolean {
        return this.#entries.get(translationId)?.ready ?? false;
    }

    isBuilding(translationId: string): boolean {
        return this.#entries.get(translationId)?.building ?? false;
    }

    anyBuilding(translationIds: string[]): boolean {
        return translationIds.some((id) => this.isBuilding(id));
    }

    allReady(translationIds: string[]): boolean {
        return translationIds.every((id) => this.isReady(id));
    }

    failed(translationIds: string[]): string[] {
        return translationIds.filter((id) => this.#entries.get(id)?.failed ?? false);
    }

    /** The ready indexes among these translations, in the order given. */
    readyIndexes(translationIds: string[]): SearchIndex[] {
        const out: SearchIndex[] = [];
        for (const id of translationIds) {
            const entry = this.#entries.get(id);
            if (entry?.ready && entry.index) out.push(entry.index);
        }
        return out;
    }
}
