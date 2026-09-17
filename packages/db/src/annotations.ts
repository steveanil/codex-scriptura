import { liveQuery, type Observable } from 'dexie';
import type { Annotation, Tag } from '@codex-scriptura/core';
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
        .replace(/^-+|-+$/g, '');
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

// ─── Tag Helpers ──────────────────────────────────────────

/** Get all defined tags. */
export async function getTags(): Promise<Tag[]> {
    return db.tags.toArray();
}

/** Save a tag. */
export async function saveTag(tag: Tag): Promise<void> {
    await db.tags.put(tag);
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
