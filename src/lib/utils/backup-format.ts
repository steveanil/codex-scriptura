/**
 * The backup file (Settings > Data). One JSON document holding everything
 * the user made in this browser: annotations, tags, saved searches and
 * preferences (which carry the reading position). Corpora are not in it;
 * they download again. The pure half lives here so parsing, validation
 * and the merge plan are testable without a database.
 */
import type { Annotation, SavedSearch, Tag, UserPreferences } from '@codex-scriptura/core';

export const BACKUP_FORMAT = 'codex-scriptura-backup';
export const BACKUP_VERSION = 1;

export type Backup = {
    format: typeof BACKUP_FORMAT;
    version: number;
    exportedAt: number;
    /** The What's New id of the build that wrote the file. */
    app: string;
    settings: UserPreferences;
    annotations: Annotation[];
    tags: Tag[];
    savedSearches: SavedSearch[];
};

export type BackupSummary = {
    exportedAt: number;
    app: string;
    annotations: number;
    notes: number;
    highlights: number;
    themes: number;
    tags: number;
    savedSearches: number;
};

export function buildBackup(parts: Omit<Backup, 'format' | 'version' | 'exportedAt'>, now = Date.now()): Backup {
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, ...parts };
}

export function backupFilename(now = new Date()): string {
    const d = now.toISOString().slice(0, 10);
    return `codex-scriptura-backup-${d}.json`;
}

/** Parse and validate; throws a readable message for the user. */
export function parseBackup(text: string): Backup {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error('That file is not JSON.');
    }
    if (!raw || typeof raw !== 'object') throw new Error('That file is not a backup.');
    const b = raw as Partial<Backup>;
    if (b.format !== BACKUP_FORMAT) throw new Error('That file is not a Codex Scriptura backup.');
    if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
        throw new Error(`This backup was written by a newer version (format ${b.version}); update the app first.`);
    }
    for (const key of ['annotations', 'tags', 'savedSearches'] as const) {
        if (!Array.isArray(b[key])) throw new Error(`The backup is missing its ${key}.`);
    }
    if (!b.settings || typeof b.settings !== 'object') throw new Error('The backup is missing its settings.');
    for (const a of b.annotations as Annotation[]) {
        if (typeof a.id !== 'string' || typeof a.verseStart !== 'string' || typeof a.type !== 'string') {
            throw new Error('An annotation in the backup is malformed.');
        }
    }
    return b as Backup;
}

export function summarize(b: Backup): BackupSummary {
    const count = (t: Annotation['type']) => b.annotations.filter((a) => a.type === t).length;
    return {
        exportedAt: b.exportedAt,
        app: b.app,
        annotations: b.annotations.length,
        notes: count('note'),
        highlights: count('highlight'),
        themes: count('theme'),
        tags: b.tags.length,
        savedSearches: b.savedSearches.length,
    };
}

export type MergePlan = {
    /** Records to write. Merge keeps local records the backup does not know; replace writes the backup only. */
    annotations: Annotation[];
    tags: Tag[];
    savedSearches: SavedSearch[];
    /** Merge keeps local settings; replace takes the backup's. */
    settings: UserPreferences | null;
    /** How many backup records overwrite a local record with the same id. */
    overwritten: number;
};

/**
 * Merge: the backup's records win on id collisions, local extras survive.
 * Replace: the backup is the whole truth (the caller clears the tables).
 */
export function planImport(
    b: Backup,
    mode: 'merge' | 'replace',
    local: { annotationIds: Set<string>; tagIds: Set<string>; searchIds: Set<string> },
): MergePlan {
    if (mode === 'replace') {
        return { annotations: b.annotations, tags: b.tags, savedSearches: b.savedSearches, settings: b.settings, overwritten: 0 };
    }
    const overwritten =
        b.annotations.filter((a) => local.annotationIds.has(a.id)).length +
        b.tags.filter((t) => local.tagIds.has(t.id)).length +
        b.savedSearches.filter((s) => local.searchIds.has(s.id)).length;
    return { annotations: b.annotations, tags: b.tags, savedSearches: b.savedSearches, settings: null, overwritten };
}
