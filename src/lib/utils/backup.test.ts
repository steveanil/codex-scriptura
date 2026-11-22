import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, SavedSearch, ScratchPadState, Tag } from '@codex-scriptura/core';
import { db, getSettings, saveAnnotation, saveSearch, saveTag, setKv } from '@codex-scriptura/db';
import { SCRATCH_PAD_KV_KEY } from '$lib/stores/scratchPad.svelte';
import { applyBackup, readBackupFile, snapshotBackup } from './backup';
import { parseBackup, type Backup } from './backup-format';

const USER_TABLES = [db.annotations, db.tags, db.savedSearches, db.settings, db.kv];

let clock = 1_000;
beforeEach(async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
    await Promise.all(USER_TABLES.map((t) => t.clear()));
});
afterEach(() => vi.restoreAllMocks());

const note = (id: string, data: string, verse = 1): Annotation => ({
    id, type: 'note', book: 'Gen', verseStart: `Gen.1.${verse}`, verseEnd: `Gen.1.${verse}`, data, tags: [], created: Date.now(), modified: 0, synced: false,
});
const tag = (id: string, name = id): Tag => ({ id, name, color: '#3f3f46' });
const search = (id: string, query: string): SavedSearch => ({ id, query, translationIds: ['KJV'], testamentFilter: 'all', created: Date.now() });
const writePad = (content: string) => setKv(SCRATCH_PAD_KV_KEY, { content, droppedVerses: [], modified: Date.now() } satisfies ScratchPadState);

/** Everything a browser profile holds in the backed-up tables, sorted so two profiles compare. */
async function dump() {
    const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    return {
        annotations: byId(await db.annotations.toArray()),
        tags: byId(await db.tags.toArray()),
        savedSearches: byId(await db.savedSearches.toArray()),
        settings: await db.settings.toArray(),
        kv: byId(await db.kv.toArray()),
    };
}
type Profile = Awaited<ReturnType<typeof dump>>;

/** Swap the one fake database between two simulated browsers. */
async function become(p: Profile | null) {
    await Promise.all(USER_TABLES.map((t) => t.clear()));
    if (!p) return;
    await db.annotations.bulkPut(p.annotations);
    await db.tags.bulkPut(p.tags);
    await db.savedSearches.bulkPut(p.savedSearches);
    await db.settings.bulkPut(p.settings);
    await db.kv.bulkPut(p.kv);
}

/** What the user carries between browsers: the exported file, read back the way the import reads it. */
const exportFile = async () => JSON.stringify(await snapshotBackup());
const importFile = (text: string, mode: 'merge' | 'replace') => applyBackup(parseBackup(text), mode);

async function seedLocal() {
    await saveAnnotation(note('n1', 'local note'));
    await saveTag(tag('t1'));
    await saveSearch(search('s1', 'grace'));
    await writePad('local pad');
}

describe('validation happens before the database is touched', () => {
    const validFile = async (): Promise<Backup> => JSON.parse(await exportFile());
    const cases: [string, (b: Backup) => void][] = [
        ['annotation', (b) => b.annotations.push({ ...note('bad', 'x'), verseStart: 'Gen 1:1' })],
        ['tag', (b) => b.tags.push({ id: 'bad', name: 3 } as unknown as Tag)],
        ['saved search', (b) => b.savedSearches.push({ ...search('bad', 'x'), testamentFilter: 'Gospels' } as unknown as SavedSearch)],
        ['settings', (b) => { b.settings = { ...b.settings, theme: 'sepia' } as unknown as Backup['settings']; }],
        ['scratch pad', (b) => { b.scratchPad = { content: null } as unknown as ScratchPadState; }],
    ];
    for (const [type, corrupt] of cases) {
        it(`rejects a malformed ${type} without opening a transaction`, async () => {
            await seedLocal();
            const file = await validFile();
            file.annotations.push(note('fresh', 'would be new'));
            corrupt(file);
            const before = await dump();
            const tx = vi.spyOn(db, 'transaction');
            await expect(readBackupFile(new File([JSON.stringify(file)], 'b.json'))).rejects.toThrow(/nothing was imported/);
            expect(tx).not.toHaveBeenCalled();
            tx.mockRestore();
            expect(await dump()).toEqual(before);
        });
    }
});

describe('an import that fails part way', () => {
    for (const mode of ['merge', 'replace'] as const) {
        it(`${mode} leaves the database exactly as it was`, async () => {
            await seedLocal();
            const file = await snapshotBackup();
            file.annotations = [note('n2', 'from backup'), { ...file.annotations[0], data: 'backup copy', modified: Date.now() + 1e6 }];
            file.tags.push(tag('t2'));
            file.scratchPad = { content: 'backup pad', droppedVerses: [], modified: Date.now() + 1e6 };
            const before = await dump();
            // Annotations and tags are already written (and in replace, the tables cleared) when this throws
            vi.spyOn(db.savedSearches, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
            await expect(applyBackup(file, mode)).rejects.toThrow('disk full');
            expect(await dump()).toEqual(before);
        });
    }
});

describe('export during writes', () => {
    it('is one snapshot: every file holds whole write transactions, never half of one', async () => {
        // Each write adds an annotation and its tag together, so any file
        // that has one without the other was read across a write.
        const writes = (async () => {
            for (let i = 0; i < 40; i++) {
                await db.transaction('rw', db.annotations, db.tags, async () => {
                    await db.annotations.put({ ...note(`a${i}`, `note ${i}`), modified: Date.now() });
                    await db.tags.put(tag(`a${i}`));
                });
            }
        })();
        const files: Backup[] = [];
        const exports = (async () => {
            for (let i = 0; i < 20; i++) files.push(await snapshotBackup());
        })();
        await Promise.all([writes, exports]);
        const sizes = new Set<number>();
        for (const f of files) {
            expect(f.annotations.map((a) => a.id).sort()).toEqual(f.tags.map((t) => t.id).sort());
            sizes.add(f.annotations.length);
        }
        // Otherwise the test ran the exports entirely before or after the writes and proved nothing
        expect(sizes.size).toBeGreaterThan(2);
    });
});

describe('moving study data between two browsers and back', () => {
    it('loses nothing and never lets an older backup copy overwrite a newer local one', async () => {
        // Browser A: the original profile
        await saveAnnotation(note('n1', 'shared note, first draft', 1));
        await saveAnnotation(note('n2', 'second note', 2));
        await saveTag(tag('t1', 'creation'));
        await saveSearch(search('s1', 'covenant'));
        await writePad('pad written on A');
        const fileA1 = await exportFile();
        const a1 = await dump();

        // Browser B: fresh profile, merge A's file
        await become(null);
        const firstImport = await importFile(fileA1, 'merge');
        expect(firstImport.annotations.added).toHaveLength(2);
        const b1 = await dump();
        expect({ ...b1, settings: [] }).toEqual({ ...a1, settings: [] });

        // B edits: the shared note (later than A will), a different note, the search; adds its own note and tag
        const bEdit = async (id: string, data: string) => saveAnnotation({ ...(await db.annotations.get(id))!, data });
        await bEdit('n2', 'second note, edited on B');
        await saveAnnotation(note('nB', 'only on B', 5));
        await saveTag(tag('tB', 'b-tag'));
        await saveSearch({ ...(await db.savedSearches.get('s1'))!, query: 'covenant of grace' });
        const b2pre = await dump();

        // Meanwhile on A: the shared note, A's own new note, the pad
        await become(a1);
        await bEdit('n1', 'shared note, edited on A');
        await saveAnnotation(note('nA', 'only on A', 4));
        await writePad('pad edited on A');
        const a2pre = await dump();

        // Back on B, the shared note is edited last, so B's copy is the newest
        await become(b2pre);
        await bEdit('n1', 'shared note, edited on B last');
        const fileB = await exportFile();
        const b2 = await dump();

        await become(a2pre);
        const fileA2 = await exportFile();

        // Merge B's file into A
        const intoA = await importFile(fileB, 'merge');
        expect(intoA.annotations.newer.map((c) => c.incoming.id).sort()).toEqual(['n1', 'n2']);
        expect(intoA.annotations.added.map((a) => a.id)).toEqual(['nB']);
        expect(intoA.annotations.localOnly.map((a) => a.id)).toEqual(['nA']);
        expect(intoA.scratchPad).toBeNull();
        const a3 = await dump();

        // Merge A's file (taken before it saw B's edits) into B
        await become(b2);
        const intoB = await importFile(fileA2, 'merge');
        expect(intoB.annotations.older.map((c) => c.incoming.id).sort()).toEqual(['n1', 'n2']);
        expect(intoB.annotations.added.map((a) => a.id)).toEqual(['nA']);
        expect(intoB.savedSearches.older.map((c) => c.incoming.id)).toEqual(['s1']);
        expect(intoB.scratchPad?.content).toBe('pad edited on A');
        const b3 = await dump();

        // Both browsers end with the same data, and every edit survived on both
        expect(b3).toEqual(a3);
        const data = Object.fromEntries(b3.annotations.map((a) => [a.id, a.data]));
        expect(data).toEqual({
            n1: 'shared note, edited on B last',
            n2: 'second note, edited on B',
            nA: 'only on A',
            nB: 'only on B',
        });
        expect(b3.tags.map((t) => t.name).sort()).toEqual(['b-tag', 'creation']);
        expect(b3.savedSearches.map((s) => s.query)).toEqual(['covenant of grace']);
        expect((b3.kv.find((k) => k.id === SCRATCH_PAD_KV_KEY)?.value as ScratchPadState).content).toBe('pad edited on A');
        expect((await getSettings()).id).toBe('default');
    });
});
