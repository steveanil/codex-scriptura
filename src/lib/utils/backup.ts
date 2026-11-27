/**
 * Backup export and import against the database (Settings > Data). The
 * format, validation and merge plan are in backup-format.ts.
 */
import type { ScratchPadState } from '@codex-scriptura/core';
import { db, getKv, getSettings, setKv } from '@codex-scriptura/db';
import { LATEST_UPDATE_ID } from '$lib/whats-new';
import { SCRATCH_PAD_KV_KEY } from '$lib/stores/scratchPad.svelte';
import { backupFilename, buildBackup, parseBackup, planImport, summarize, type Backup, type BackupSummary, type ImportPlan, type LocalState } from './backup-format';

export const LAST_EXPORT_KEY = 'lastBackupExport';

export async function lastExportAt(): Promise<number | null> {
    return (await getKv<number>(LAST_EXPORT_KEY)) ?? null;
}

async function readScratchPad(): Promise<ScratchPadState | undefined> {
    return (await db.kv.get(SCRATCH_PAD_KV_KEY))?.value as ScratchPadState | undefined;
}

/** Every exported table read in one transaction, so an edit landing mid-export cannot split the file. */
export async function snapshotBackup(): Promise<Backup> {
    return db.transaction('r', [db.settings, db.annotations, db.tags, db.savedSearches, db.kv], async () => {
        const [settings, annotations, tags, savedSearches, scratchPad] = await Promise.all([
            getSettings(), db.annotations.toArray(), db.tags.toArray(), db.savedSearches.toArray(), readScratchPad(),
        ]);
        return buildBackup({ app: LATEST_UPDATE_ID, settings, annotations, tags, savedSearches, ...(scratchPad ? { scratchPad } : {}) });
    });
}

/** Writes the file through a download link and records the time. */
export async function exportBackup(): Promise<BackupSummary> {
    const backup = await snapshotBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await setKv(LAST_EXPORT_KEY, backup.exportedAt);
    return summarize(backup);
}

export async function readBackupFile(file: File): Promise<{ backup: Backup; summary: BackupSummary }> {
    const backup = parseBackup(await file.text());
    return { backup, summary: summarize(backup) };
}

async function readLocal(): Promise<LocalState> {
    const [annotations, tags, savedSearches, scratchPad] = await Promise.all([
        db.annotations.toArray(), db.tags.toArray(), db.savedSearches.toArray(), readScratchPad(),
    ]);
    return { annotations, tags, savedSearches, scratchPad };
}

/** What this browser holds now, for the import preview. The import itself reads again inside its transaction. */
export async function readLocalState(): Promise<LocalState> {
    return db.transaction('r', [db.annotations, db.tags, db.savedSearches, db.kv], readLocal);
}

/**
 * Reads local records, plans and writes in one transaction, so nothing
 * can change between deciding and writing, and a failure part way leaves
 * the database as it was. Returns the plan it applied.
 */
export async function applyBackup(backup: Backup, mode: 'merge' | 'replace'): Promise<ImportPlan> {
    return db.transaction('rw', [db.annotations, db.tags, db.savedSearches, db.settings, db.kv], async () => {
        const plan = planImport(backup, mode, await readLocal());
        if (mode === 'replace') {
            await Promise.all([db.annotations.clear(), db.tags.clear(), db.savedSearches.clear()]);
        }
        await db.annotations.bulkPut(plan.annotations.write);
        await db.tags.bulkPut(plan.tags.write);
        await db.savedSearches.bulkPut(plan.savedSearches.write);
        if (plan.settings) await db.settings.put({ ...plan.settings, id: 'default' });
        if (plan.scratchPad) await db.kv.put({ id: SCRATCH_PAD_KV_KEY, value: plan.scratchPad });
        return plan;
    });
}
