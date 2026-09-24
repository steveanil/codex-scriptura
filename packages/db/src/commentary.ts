import type { CommentaryEntry } from '@codex-scriptura/core';
import { compareCanonical, parseOsisId } from '@codex-scriptura/core';
import { db } from './database.js';
import type { StreamInstallPlan } from './datasets.js';

// ─── Commentary (issue #83) ────────────────────────────────
// One dataset per commentary resource. The primary key is
// [resourceId+id]: entry ids are local to their commentary, so two
// resources may use the same id for the same passage and both survive.

const BATCH = 2_000;

/** Install plan for one commentary resource's entries: its own rows only. Records arrive already validated and stamped (toCommentaryEntry). */
export function commentaryPlan(resourceId: string): StreamInstallPlan<CommentaryEntry> {
    return {
        tables: [db.commentaryEntries],
        clear: () => db.commentaryEntries.where('resourceId').equals(resourceId).delete(),
        insertPart: async (records, report) => {
            for (let i = 0; i < records.length; i += BATCH) {
                await db.commentaryEntries.bulkPut(records.slice(i, i + BATCH));
                report(Math.min(1, (i + BATCH) / records.length));
            }
            return records.length;
        },
    };
}

const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function canonical(a: CommentaryEntry, b: CommentaryEntry): number {
    return compareCanonical(parseOsisId(a.startRef)!, parseOsisId(b.startRef)!)
        || compareCanonical(parseOsisId(a.endRef)!, parseOsisId(b.endRef)!)
        || text(a.id, b.id)
        || text(a.resourceId, b.resourceId);
}

/**
 * Every entry whose range overlaps a chapter, in canonical order of start
 * then end, from one multi-entry index read; optionally one resource's only.
 */
export async function getCommentaryForChapter(book: string, chapter: number, resourceId?: string): Promise<CommentaryEntry[]> {
    let query = db.commentaryEntries.where('chapters').equals(`${book}.${chapter}`);
    if (resourceId) query = query.and((e) => e.resourceId === resourceId);
    return (await query.toArray()).sort(canonical);
}

/** Drop one commentary resource's entries; the caller removes its receipt. */
export async function removeCommentaryData(resourceId: string): Promise<void> {
    await db.commentaryEntries.where('resourceId').equals(resourceId).delete();
}
