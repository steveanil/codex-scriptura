import { liveQuery, type Observable } from 'dexie';
import type { Annotation, Tag } from '@codex-scriptura/core';
import { db } from './database.js';

/**
 * Note tags (issue #323). Annotations carry tag names in `tags`; the `tags`
 * table is a registry of known names. Theme annotations reuse `tags[0]` for
 * their thread slug, so every operation here skips type 'theme': a note
 * tagged "covenant" and a theme thread "covenant" share the index but are
 * different things.
 */

/** Get all registered tags. */
export async function getTags(): Promise<Tag[]> {
    return db.tags.toArray();
}

/** Save a tag. */
export async function saveTag(tag: Tag): Promise<void> {
    tag.modified = Date.now();
    await db.tags.put(tag);
}

/** The one spelling of a tag name: trimmed, lowercased, inner whitespace collapsed. */
export function normalizeTagName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type TagSummary = { name: string; count: number; registered: boolean };

export type TagCollision = { name: string; count: number; sourceCount: number };

export type TagRenameResult =
    | { status: 'renamed'; count: number }
    | { status: 'collision'; collision: TagCollision };

const DEFAULT_COLOR = '#3f3f46';

function requireName(name: string): string {
    const n = normalizeTagName(name);
    if (!n) throw new Error('A tag name cannot be empty');
    return n;
}

function tagged(): Promise<Annotation[]> {
    return db.annotations.filter((a) => a.type !== 'theme' && a.tags.length > 0).toArray();
}

/** Annotations carrying the tag under any stored spelling (a backup may bring "Grace " next to "grace"). */
function carrying(all: Annotation[], name: string): Annotation[] {
    return all.filter((a) => a.tags.some((t) => normalizeTagName(t) === name));
}

function registryRows(rows: Tag[], name: string): Tag[] {
    return rows.filter((r) => normalizeTagName(r.name) === name);
}

async function summarize(): Promise<TagSummary[]> {
    const [rows, anns] = await Promise.all([db.tags.toArray(), tagged()]);
    const byName = new Map<string, TagSummary>();
    for (const r of rows) {
        const name = normalizeTagName(r.name);
        if (name) byName.set(name, { name, count: 0, registered: true });
    }
    for (const a of anns) {
        // A tag repeated on one annotation under two spellings still counts once
        for (const name of new Set(a.tags.map(normalizeTagName))) {
            if (!name) continue;
            const s = byName.get(name);
            if (s) s.count++;
            else byName.set(name, { name, count: 1, registered: false });
        }
    }
    return [...byName.values()];
}

/**
 * Every tag with how many annotations carry it: registered names (0 if
 * unused) plus names found on annotations without a registry row. Most
 * used first, then alphabetical.
 */
export async function listTags(): Promise<TagSummary[]> {
    const list = await db.transaction('r', db.tags, db.annotations, summarize);
    return list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Live view of listTags, re-emitting on any tag or annotation change (other tabs included). */
export function observeTags(): Observable<TagSummary[]> {
    return liveQuery(listTags);
}

/** Register a tag name. A name that already exists is left as it is and reported. */
export async function createTag(name: string): Promise<{ name: string; created: boolean }> {
    const n = requireName(name);
    return db.transaction('rw', db.tags, db.annotations, async () => {
        if (registryRows(await db.tags.toArray(), n).length > 0) return { name: n, created: false };
        await saveTag({ id: crypto.randomUUID(), name: n, color: DEFAULT_COLOR });
        return { name: n, created: true };
    });
}

/** Swap `from` for `to` on every annotation carrying it, without duplicating `to`. Returns how many changed. */
async function retag(all: Annotation[], from: string, to: string | null): Promise<number> {
    const now = Date.now();
    const changed: Annotation[] = [];
    for (const a of carrying(all, from)) {
        const next: string[] = [];
        for (const t of a.tags) {
            const out = normalizeTagName(t) === from ? to : t;
            if (out !== null && !next.some((x) => normalizeTagName(x) === normalizeTagName(out))) next.push(out);
        }
        if (next.join('\n') !== a.tags.join('\n')) changed.push({ ...a, tags: next, modified: now });
    }
    await db.annotations.bulkPut(changed);
    return changed.length;
}

/** Leave exactly one registry row spelled `name` (reusing `rows[0]` when given) and drop `alsoDrop`. */
async function registerOnly(rows: Tag[], name: string, alsoDrop: Tag[] = []): Promise<void> {
    const [keep, ...extra] = rows;
    if (!keep) await saveTag({ id: crypto.randomUUID(), name, color: DEFAULT_COLOR });
    else if (keep.name !== name) await saveTag({ ...keep, name });
    const drop = [...extra, ...alsoDrop].map((r) => r.id);
    if (drop.length) await db.tags.bulkDelete(drop);
}

/**
 * Rename a tag on every annotation and on its registry row, in one
 * transaction. Renaming onto a name that already exists does nothing and
 * reports the collision; folding the two together is mergeTags.
 */
export async function renameTag(from: string, to: string): Promise<TagRenameResult> {
    const source = requireName(from);
    const target = requireName(to);
    return db.transaction('rw', db.tags, db.annotations, async () => {
        const [rows, all] = await Promise.all([db.tags.toArray(), tagged()]);
        if (target !== source) {
            const targetCount = carrying(all, target).length;
            if (targetCount > 0 || registryRows(rows, target).length > 0) {
                return { status: 'collision', collision: { name: target, count: targetCount, sourceCount: carrying(all, source).length } };
            }
        }
        const sourceRows = registryRows(rows, source);
        if (sourceRows.length === 0 && carrying(all, source).length === 0) throw new Error(`No tag named "${source}"`);
        const count = await retag(all, source, target);
        // The source's own row takes the new name, so its id survives the rename
        await registerOnly(sourceRows, target);
        return { status: 'renamed', count };
    });
}

/**
 * Fold `from` into `into`: annotations carrying `from` carry `into` instead
 * (once, if they had both) and `from` leaves the registry. Returns how many
 * annotations changed.
 */
export async function mergeTags(from: string, into: string): Promise<number> {
    const source = requireName(from);
    const target = requireName(into);
    if (source === target) return 0;
    return db.transaction('rw', db.tags, db.annotations, async () => {
        const [rows, all] = await Promise.all([db.tags.toArray(), tagged()]);
        const count = await retag(all, source, target);
        await registerOnly(registryRows(rows, target), target, registryRows(rows, source));
        return count;
    });
}

/** Detach a tag from every annotation and drop its registry row; no annotation is deleted. Returns how many changed. */
export async function deleteTag(name: string): Promise<number> {
    const n = requireName(name);
    return db.transaction('rw', db.tags, db.annotations, async () => {
        const [rows, all] = await Promise.all([db.tags.toArray(), tagged()]);
        const count = await retag(all, n, null);
        const drop = registryRows(rows, n).map((r) => r.id);
        if (drop.length) await db.tags.bulkDelete(drop);
        return count;
    });
}
