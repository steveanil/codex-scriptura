import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@codex-scriptura/core';
import { db } from './database';
import { createTag, deleteTag, listTags, mergeTags, normalizeTagName, observeTags, renameTag, saveTag } from './tags';

let seq = 0;
function ann(over: Partial<Annotation>): Annotation {
    return {
        id: `a${++seq}`,
        type: 'note',
        book: 'Gen',
        verseStart: 'Gen.1.1',
        verseEnd: 'Gen.1.1',
        data: 'a note',
        tags: [],
        created: 1,
        modified: 1,
        synced: false,
        ...over,
    };
}
const reg = (name: string) => saveTag({ id: `t-${name}`, name, color: '#3f3f46' });
const get = async (id: string) => (await db.annotations.get(id))!;

beforeEach(async () => {
    await Promise.all([db.annotations.clear(), db.tags.clear()]);
});
afterEach(() => vi.restoreAllMocks());

describe('normalizeTagName', () => {
    it('trims, lowercases and collapses inner whitespace', () => {
        expect(normalizeTagName('  Holy   Spirit\t')).toBe('holy spirit');
        expect(normalizeTagName('   ')).toBe('');
    });
});

describe('listTags', () => {
    it('joins the registry with names actually used, counting non-theme annotations only', async () => {
        await reg('unused');
        await reg('grace');
        await db.annotations.bulkPut([
            ann({ tags: ['grace'] }),
            ann({ tags: ['Grace ', 'grace'] }), // two spellings on one note count once
            ann({ tags: ['imported'] }), // used but never registered (a backup import)
            ann({ type: 'theme', data: 'Grace', tags: ['grace'] }),
        ]);
        expect(await listTags()).toEqual([
            { name: 'grace', count: 2, registered: true },
            { name: 'imported', count: 1, registered: false },
            { name: 'unused', count: 0, registered: true },
        ]);
    });

    it('observeTags re-emits on writes', async () => {
        const seen: number[] = [];
        const sub = observeTags().subscribe((l) => seen.push(l.length));
        await vi.waitFor(() => expect(seen).toEqual([0]));
        await createTag('new');
        await vi.waitFor(() => expect(seen).toEqual([0, 1]));
        sub.unsubscribe();
    });
});

describe('createTag', () => {
    it('registers a normalized name once, case-insensitively', async () => {
        expect(await createTag(' Faith ')).toEqual({ name: 'faith', created: true });
        expect(await createTag('FAITH')).toEqual({ name: 'faith', created: false });
        expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['faith']);
    });

    it('rejects an empty name', async () => {
        await expect(createTag('   ')).rejects.toThrow(/empty/);
        await expect(renameTag('a', ' ')).rejects.toThrow(/empty/);
    });
});

describe('renameTag', () => {
    it('rewrites the name on every carrier and the registry row, stamping only those touched', async () => {
        await reg('grace');
        await db.annotations.bulkPut([
            ann({ id: 'x', tags: ['grace', 'law'] }),
            ann({ id: 'y', book: 'Rom', tags: ['GRACE'] }),
            ann({ id: 'z', tags: ['law'] }),
        ]);
        const before = Date.now();
        expect(await renameTag('grace', 'Mercy')).toEqual({ status: 'renamed', count: 2 });
        expect((await get('x')).tags).toEqual(['mercy', 'law']);
        expect((await get('y')).tags).toEqual(['mercy']);
        expect((await get('x')).modified).toBeGreaterThanOrEqual(before);
        expect((await get('y')).modified).toBeGreaterThanOrEqual(before);
        expect((await get('z')).modified).toBe(1);
        expect(await db.tags.toArray()).toEqual([{ id: 't-grace', name: 'mercy', color: '#3f3f46' }]);
    });

    it('reports a collision with an existing name and writes nothing', async () => {
        await reg('grace');
        await reg('mercy');
        await db.annotations.bulkPut([ann({ id: 'x', tags: ['grace'] }), ann({ id: 'y', tags: ['mercy'] }), ann({ tags: ['mercy'] })]);
        expect(await renameTag('grace', 'MERCY')).toEqual({ status: 'collision', collision: { name: 'mercy', count: 2, sourceCount: 1 } });
        expect((await get('x')).tags).toEqual(['grace']);
        expect((await get('x')).modified).toBe(1);
        expect((await db.tags.toArray()).map((t) => t.name).sort()).toEqual(['grace', 'mercy']);
    });

    it('a used-but-unregistered target still collides', async () => {
        await reg('grace');
        await db.annotations.put(ann({ tags: ['mercy'] }));
        expect((await renameTag('grace', 'mercy')).status).toBe('collision');
    });

    it('throws for a name that does not exist', async () => {
        await expect(renameTag('ghost', 'other')).rejects.toThrow(/No tag/);
    });

    it('rolls everything back when a write fails mid-way', async () => {
        await reg('grace');
        await db.annotations.bulkPut([ann({ id: 'x', tags: ['grace'] }), ann({ id: 'y', tags: ['grace'] })]);
        // The registry write comes after the annotation writes
        vi.spyOn(db.tags, 'put').mockRejectedValueOnce(new Error('disk full'));
        await expect(renameTag('grace', 'mercy')).rejects.toThrow('disk full');
        expect((await get('x')).tags).toEqual(['grace']);
        expect((await get('y')).tags).toEqual(['grace']);
        expect((await get('y')).modified).toBe(1);
        expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['grace']);
    });
});

describe('mergeTags', () => {
    it('folds one tag into another without duplicates and drops the source row', async () => {
        await reg('grace');
        await reg('mercy');
        await db.annotations.bulkPut([
            ann({ id: 'both', tags: ['grace', 'mercy'] }),
            ann({ id: 'src', tags: ['law', 'grace'] }),
            ann({ id: 'dst', tags: ['mercy'] }),
        ]);
        expect(await mergeTags('grace', 'mercy')).toBe(2);
        expect((await get('both')).tags).toEqual(['mercy']);
        expect((await get('src')).tags).toEqual(['law', 'mercy']);
        expect((await get('dst')).modified).toBe(1);
        expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['mercy']);
        expect(await listTags()).toEqual([
            { name: 'mercy', count: 3, registered: true },
            { name: 'law', count: 1, registered: false },
        ]);
    });
});

describe('deleteTag', () => {
    it('detaches the name everywhere, keeps every annotation, and leaves no reference', async () => {
        await reg('grace');
        await saveTag({ id: 'dup', name: 'Grace', color: '#000' }); // a legacy variant row
        await db.annotations.bulkPut([
            ann({ id: 'x', tags: ['grace', 'law'] }),
            ann({ id: 'y', type: 'highlight', data: '#ff0', tags: ['Grace'] }),
            ann({ id: 'z', tags: ['law'] }),
        ]);
        expect(await deleteTag('GRACE')).toBe(2);
        expect(await db.annotations.count()).toBe(3);
        expect((await get('x')).tags).toEqual(['law']);
        expect((await get('y')).tags).toEqual([]);
        expect((await get('z')).modified).toBe(1);
        expect(await db.tags.count()).toBe(0);
        const remaining = (await db.annotations.toArray()).flatMap((a) => a.tags).map(normalizeTagName);
        expect(remaining).not.toContain('grace');
        expect(await db.annotations.where('tags').anyOf('grace', 'Grace').count()).toBe(0);
    });

    it('rolls back when the registry delete fails', async () => {
        await reg('grace');
        await db.annotations.put(ann({ id: 'x', tags: ['grace'] }));
        vi.spyOn(db.tags, 'bulkDelete').mockRejectedValueOnce(new Error('boom'));
        await expect(deleteTag('grace')).rejects.toThrow('boom');
        expect((await get('x')).tags).toEqual(['grace']);
        expect(await db.tags.count()).toBe(1);
    });
});

describe('note tags and theme slugs stay apart', () => {
    it('no tag operation touches a theme thread with the same string', async () => {
        await reg('covenant');
        await reg('promise');
        const theme = ann({ id: 'th', type: 'theme', data: 'Covenant', tags: ['covenant'] });
        await db.annotations.bulkPut([theme, ann({ id: 'n', tags: ['covenant'] }), ann({ tags: ['promise'] })]);

        await renameTag('covenant', 'pact');
        expect(await get('th')).toEqual(theme);
        await mergeTags('pact', 'promise');
        expect(await get('th')).toEqual(theme);
        await deleteTag('promise');
        expect(await get('th')).toEqual(theme);
        expect((await get('n')).tags).toEqual([]);

        // And a theme slug alone is not a tag
        expect(await listTags()).toEqual([]);
        await expect(renameTag('covenant', 'x')).rejects.toThrow(/No tag/);
    });
});
