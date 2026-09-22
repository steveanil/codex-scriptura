import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

const manager = vi.hoisted(() => ({
    getOrBuildIndex: vi.fn<(id: string) => Promise<unknown>>(),
    releaseIndex: vi.fn(),
}));
vi.mock('./index-manager', () => manager);

import { SearchIndexSet } from './index-set.svelte';

type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
function deferred(): Deferred {
    let resolve!: Deferred['resolve'];
    let reject!: Deferred['reject'];
    const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    manager.getOrBuildIndex.mockReset();
    manager.releaseIndex.mockReset();
});

describe('SearchIndexSet', () => {
    it('tracks building, then ready, and lists ready indexes in selection order', async () => {
        const kjv = deferred();
        const web = deferred();
        manager.getOrBuildIndex.mockImplementation((id) => (id === 'KJV' ? kjv.promise : web.promise));

        const set = new SearchIndexSet();
        set.sync(['WEB', 'KJV']);
        expect(set.anyBuilding(['WEB', 'KJV'])).toBe(true);
        expect(set.allReady(['WEB', 'KJV'])).toBe(false);

        kjv.resolve('kjv-index');
        await settle();
        expect(set.isReady('KJV')).toBe(true);
        expect(set.isBuilding('WEB')).toBe(true);
        expect(set.readyIndexes(['WEB', 'KJV'])).toEqual(['kjv-index']);

        web.resolve('web-index');
        await settle();
        expect(set.allReady(['WEB', 'KJV'])).toBe(true);
        expect(set.readyIndexes(['WEB', 'KJV'])).toEqual(['web-index', 'kjv-index']);
        flushSync();
        expect(set.readyKey).toBe('KJV,WEB');
    });

    it('does not resurrect an index released while it was loading', async () => {
        const kjv = deferred();
        manager.getOrBuildIndex.mockReturnValue(kjv.promise);

        const set = new SearchIndexSet();
        set.sync(['KJV']);
        set.sync([]);
        expect(manager.releaseIndex).toHaveBeenCalledWith('KJV');

        kjv.resolve('kjv-index');
        await settle();
        expect(set.isReady('KJV')).toBe(false);
        expect(set.readyIndexes(['KJV'])).toEqual([]);
        // The late arrival is handed back too, so the manager holds nothing the page does not
        expect(manager.releaseIndex).toHaveBeenCalledTimes(2);
    });

    it('records a failure as neither ready nor building, so ensure() retries it', async () => {
        manager.getOrBuildIndex.mockRejectedValueOnce(new Error('quota'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const set = new SearchIndexSet();
        set.sync(['KJV']);
        await settle();
        expect(set.failed(['KJV'])).toEqual(['KJV']);
        expect(set.isBuilding('KJV')).toBe(false);

        manager.getOrBuildIndex.mockResolvedValueOnce('kjv-index');
        await set.ensure('KJV');
        expect(set.failed(['KJV'])).toEqual([]);
        expect(set.isReady('KJV')).toBe(true);
        spy.mockRestore();
    });

    it('sync() is a no-op for translations already ready or loading', async () => {
        manager.getOrBuildIndex.mockResolvedValue('idx');
        const set = new SearchIndexSet();
        set.sync(['KJV']);
        set.sync(['KJV']);
        await settle();
        set.sync(['KJV']);
        expect(manager.getOrBuildIndex).toHaveBeenCalledTimes(1);
        expect(manager.releaseIndex).not.toHaveBeenCalled();
    });
});
