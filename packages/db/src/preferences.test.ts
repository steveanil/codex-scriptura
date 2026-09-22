import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { getKv, setKv, deleteKv } from './preferences';

describe('kv store', () => {
    it('round-trips structured values', async () => {
        await setKv('t', { count: 2, locations: [{ book: 'Gen', chapter: 1 }] });
        expect(await getKv<{ count: number }>('t')).toEqual({
            count: 2,
            locations: [{ book: 'Gen', chapter: 1 }],
        });
    });

    it('overwrites on repeat set and returns undefined after delete / for missing keys', async () => {
        await setKv('t2', 1);
        await setKv('t2', 2);
        expect(await getKv<number>('t2')).toBe(2);
        await deleteKv('t2');
        expect(await getKv('t2')).toBeUndefined();
        expect(await getKv('never-set')).toBeUndefined();
    });
});
