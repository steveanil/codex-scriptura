import { liveQuery, type Observable } from 'dexie';
import type { Annotation, AnnotationType } from '@codex-scriptura/core';
import { db } from './database.js';

// ─── Annotation Helpers ───────────────────────────────────

/** 
 * Get all annotations for a specific book.
 * It is highly efficient to query by book, then filter by chapter/verses 
 * in-memory to handle cross-chapter highlights.
 */
export async function getAnnotationsForBook(book: string): Promise<Annotation[]> {
    return db.annotations
        .where('book')
        .equals(book)
        .toArray();
}

/**
 * Live-updating view of a book's annotations. Re-emits whenever the
 * annotations table changes - including writes from other browser tabs,
 * via Dexie's built-in cross-tab observability - so subscribers never
 * need a manual reload after a save or delete.
 */
export function observeAnnotationsForBook(book: string): Observable<Annotation[]> {
    return liveQuery(() => getAnnotationsForBook(book));
}

/** Save or update an annotation. */
export async function saveAnnotation(annotation: Annotation): Promise<void> {
    annotation.modified = Date.now();
    await db.annotations.put(annotation);
}

/** Delete an annotation. */
export async function deleteAnnotation(id: string): Promise<void> {
    await db.annotations.delete(id);
}

// ─── Clearing by type (issue #277) ────────────────────────

/**
 * Delete every annotation of one type and return what was removed, so the
 * caller can offer Undo through restoreAnnotations.
 */
export async function deleteAnnotationsOfType(type: AnnotationType): Promise<Annotation[]> {
    return db.transaction('rw', db.annotations, async () => {
        const removed = await db.annotations.where('type').equals(type).toArray();
        await db.annotations.bulkDelete(removed.map((a) => a.id));
        return removed;
    });
}

/**
 * Put records back exactly as they were. Unlike saveAnnotation this keeps
 * `modified`: an undo is not an edit.
 */
export async function restoreAnnotations(records: Annotation[]): Promise<void> {
    await db.annotations.bulkPut(records);
}

/** Live count of annotations per type, for the given types. */
export function observeAnnotationCounts<T extends AnnotationType>(types: readonly T[]): Observable<Record<T, number>> {
    return liveQuery(async () => {
        const counts = await Promise.all(types.map((t) => db.annotations.where('type').equals(t).count()));
        return Object.fromEntries(types.map((t, i) => [t, counts[i]])) as Record<T, number>;
    });
}

// ─── Theme Helpers (theme threading, issue #22) ───────────

/**
 * Slugify a theme label for storage in tags[0]: "God's Covenant" → "gods-covenant".
 * The slug is the thread's identity; labels differing only in case or
 * punctuation join the same thread.
 */
export function themeSlug(label: string): string {
    return label
        .toLowerCase()
        .trim()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        // Runs are already collapsed above, so at most one dash can lead or trail
        .replace(/^-|-$/g, '');
}

export type ThemeSummary = { slug: string; label: string; count: number };

/**
 * All distinct themes with their tagged-range counts. The display label is
 * taken from the most recently modified annotation carrying the slug, so
 * relabeling a theme (retagging with different casing) wins going forward.
 */
export async function getThemes(): Promise<ThemeSummary[]> {
    const all = await db.annotations.where('type').equals('theme').toArray();
    const bySlug = new Map<string, { label: string; count: number; modified: number }>();
    for (const a of all) {
        const slug = a.tags[0];
        if (!slug) continue;
        const existing = bySlug.get(slug);
        if (!existing) {
            bySlug.set(slug, { label: a.data || slug, count: 1, modified: a.modified });
        } else {
            existing.count++;
            if (a.modified > existing.modified) {
                existing.modified = a.modified;
                existing.label = a.data || slug;
            }
        }
    }
    return Array.from(bySlug.entries())
        .map(([slug, v]) => ({ slug, label: v.label, count: v.count }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/** All theme annotations for one slug, resolved via the multi-entry tags index. */
export async function getThemeAnnotations(slug: string): Promise<Annotation[]> {
    return db.annotations
        .where('tags').equals(slug)
        .and(a => a.type === 'theme')
        .toArray();
}

/** Live view of getThemes (other tabs included). */
export function observeThemes(): Observable<ThemeSummary[]> {
    return liveQuery(getThemes);
}

export type ThemeRenameResult =
    | { status: 'renamed'; slug: string; count: number }
    | { status: 'collision'; collision: ThemeSummary; sourceCount: number };

function requireThemeSlug(label: string): string {
    const slug = themeSlug(label);
    if (!slug) throw new Error('A theme name needs at least one letter or digit');
    return slug;
}

/** Relabel every annotation in `slugs` as `label` under its slug, stamping modified. */
async function relabelThreads(slugs: string[], label: string): Promise<{ slug: string; count: number }> {
    const slug = themeSlug(label);
    const anns = (await db.annotations.where('tags').anyOf(slugs).distinct().toArray())
        .filter((a) => a.type === 'theme' && slugs.includes(a.tags[0]));
    const now = Date.now();
    // Folding two threads can leave the same range in the thread twice; keep one
    const seen = new Set<string>();
    const keep: Annotation[] = [];
    const drop: string[] = [];
    for (const a of anns.sort((x, y) => (x.tags[0] === slug ? 0 : 1) - (y.tags[0] === slug ? 0 : 1))) {
        const range = `${a.verseStart}|${a.verseEnd}`;
        if (seen.has(range)) drop.push(a.id);
        else {
            seen.add(range);
            keep.push({ ...a, data: label, tags: [slug, ...a.tags.slice(1)], modified: now });
        }
    }
    await db.annotations.bulkPut(keep);
    if (drop.length) await db.annotations.bulkDelete(drop);
    return { slug, count: keep.length };
}

/**
 * Rename a theme thread in one transaction: every annotation gets the new
 * label and the new slug, so the thread opens at /themes?t=<new slug> and
 * nothing is left under the old one. A new slug that already belongs to
 * another thread does nothing and reports it; mergeThemes folds them.
 */
export async function renameTheme(slug: string, label: string): Promise<ThemeRenameResult> {
    const trimmed = label.trim();
    const next = requireThemeSlug(trimmed);
    return db.transaction('rw', db.annotations, async () => {
        const source = await getThemeAnnotations(slug);
        if (source.length === 0) throw new Error(`No theme thread "${slug}"`);
        if (next !== slug) {
            const existing = (await getThemes()).find((t) => t.slug === next);
            if (existing) return { status: 'collision', collision: existing, sourceCount: source.length };
        }
        const { count } = await relabelThreads([slug], trimmed);
        return { status: 'renamed', slug: next, count };
    });
}

/**
 * Fold the thread `slug` into the one `label` names, the whole result
 * labelled `label`. A range tagged in both threads stays once (the
 * duplicate theme record is removed; no note or highlight is touched).
 */
export async function mergeThemes(slug: string, label: string): Promise<{ slug: string; count: number }> {
    const trimmed = label.trim();
    const into = requireThemeSlug(trimmed);
    return db.transaction('rw', db.annotations, () => relabelThreads([slug, into], trimmed));
}

// ─── All Annotations ──────────────────────────────────────

/** Get all annotations across all books, newest first. */
export async function getAllAnnotations(): Promise<Annotation[]> {
    return db.annotations.orderBy('modified').reverse().toArray();
}

/**
 * Live-updating view of every annotation, newest first. The All
 * Annotations tab must reflect deletes and edits of records outside the
 * current book, which the per-book liveQuery never observes.
 */
export function observeAllAnnotations(): Observable<Annotation[]> {
    return liveQuery(() => getAllAnnotations());
}
