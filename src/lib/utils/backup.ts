/**
 * Backup export and import against the database (Settings > Data). The
 * format, validation and merge plan are in backup-format.ts.
 */
import { db, getAllAnnotations, getKv, getSavedSearches, getSettings, getTags, saveSettings, setKv } from '@codex-scriptura/db';
import { LATEST_UPDATE_ID } from '$lib/whats-new';
import { backupFilename, buildBackup, parseBackup, planImport, summarize, type Backup, type BackupSummary } from './backup-format';

export const LAST_EXPORT_KEY = 'lastBackupExport';

export async function lastExportAt(): Promise<number | null> {
    return (await getKv<number>(LAST_EXPORT_KEY)) ?? null;
}

/** Writes the file through a download link and records the time. */
export async function exportBackup(): Promise<BackupSummary> {
    const [settings, annotations, tags, savedSearches] = await Promise.all([
        getSettings(), getAllAnnotations(), getTags(), getSavedSearches(),
    ]);
    const backup = buildBackup({ app: LATEST_UPDATE_ID, settings, annotations, tags, savedSearches });
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

/** Applies the plan in one transaction; returns how many records were written. */
export async function applyBackup(backup: Backup, mode: 'merge' | 'replace'): Promise<{ written: number; overwritten: number; settingsReplaced: boolean }> {
    const [annIds, tagIds, searchIds] = await Promise.all([
        db.annotations.toCollection().primaryKeys(),
        db.tags.toCollection().primaryKeys(),
        db.savedSearches.toCollection().primaryKeys(),
    ]);
    const plan = planImport(backup, mode, {
        annotationIds: new Set(annIds as string[]),
        tagIds: new Set(tagIds as string[]),
        searchIds: new Set(searchIds as string[]),
    });
    await db.transaction('rw', db.annotations, db.tags, db.savedSearches, db.settings, async () => {
        if (mode === 'replace') {
            await Promise.all([db.annotations.clear(), db.tags.clear(), db.savedSearches.clear()]);
        }
        await db.annotations.bulkPut(plan.annotations);
        await db.tags.bulkPut(plan.tags);
        await db.savedSearches.bulkPut(plan.savedSearches);
        if (plan.settings) await saveSettings({ ...plan.settings, id: 'default' });
    });
    return {
        written: plan.annotations.length + plan.tags.length + plan.savedSearches.length,
        overwritten: plan.overwritten,
        settingsReplaced: plan.settings !== null,
    };
}
