/**
 * Deleting annotations behind an Undo toast (issue #169). A .svelte.ts
 * module because the records are reactive proxies: $state.snapshot makes
 * the plain copies undo re-saves (structuredClone throws on a proxy).
 */
import type { Annotation } from '@codex-scriptura/core';
import { saveAnnotation, deleteAnnotation } from '@codex-scriptura/db';
import { toast } from '$lib/stores/toast.svelte';

const DELETED_NOUN: Partial<Record<Annotation['type'], string>> = {
    note: 'Note', highlight: 'Highlight', theme: 'Theme tag',
};

/**
 * The records are snapshotted before the delete so undo is a plain
 * re-save; ids the caller's pane doesn't know are deleted without undo.
 */
export async function deleteWithUndo(ids: string[], known: Annotation[]) {
    const records = $state.snapshot(known.filter((a) => ids.includes(a.id)));
    for (const id of ids) await deleteAnnotation(id);
    if (records.length === 0) return;
    const noun = DELETED_NOUN[records[0].type] ?? 'Annotation';
    const label = records.length === 1 ? `${noun} deleted` : `${records.length} ${noun.toLowerCase()}s deleted`;
    toast.show(label, {
        action: {
            label: 'Undo',
            run: async () => { for (const r of records) await saveAnnotation(r); },
        },
    });
}
