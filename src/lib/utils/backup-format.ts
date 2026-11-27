/**
 * The backup file (Settings > Data). One JSON document holding everything
 * the user made in this browser: annotations, tags, saved searches,
 * preferences (which carry the reading position) and the scratch pad.
 * Corpora are not in it; they download again. The pure half lives here so
 * parsing, validation and the merge plan are testable without a database.
 * The contract, including what sync (#62) inherits, is docs/backup-format.md.
 */
import { BOOKS, parseOsisId, type Annotation, type SavedSearch, type ScratchPadState, type Tag, type UserPreferences } from '@codex-scriptura/core';

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
    /** Added within version 1; files from earlier builds do not have it. */
    scratchPad?: ScratchPadState;
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
    scratchPad: boolean;
};

export function buildBackup(parts: Omit<Backup, 'format' | 'version' | 'exportedAt'>, now = Date.now()): Backup {
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, ...parts };
}

export function backupFilename(now = new Date()): string {
    const d = now.toISOString().slice(0, 10);
    return `codex-scriptura-backup-${d}.json`;
}

/** A file that parsed as a backup but holds records the app cannot use. */
export class BackupValidationError extends Error {
    constructor(readonly problems: string[]) {
        super(
            problems.length === 1
                ? `The backup has a malformed record, so nothing was imported: ${problems[0]}`
                : `The backup has ${problems.length} problems, so nothing was imported. The first: ${problems[0]}`,
        );
        this.name = 'BackupValidationError';
    }
}

// ─── Validation ───────────────────────────────────────────

// Keyed by the core unions so a new member there fails to compile here until the validator accepts it
const ANNOTATION_TYPES: Record<Annotation['type'], true> = { highlight: true, note: true, bookmark: true, memorization: true, theme: true };
const TESTAMENTS: Record<SavedSearch['testamentFilter'], true> = { all: true, OT: true, NT: true, AP: true };
const SEARCH_MODES: Record<NonNullable<SavedSearch['mode']>, true> = { fulltext: true, concordance: true, lexicon: true, topics: true, annotations: true };
const isKey = (table: Record<string, true>, v: unknown) => typeof v === 'string' && Object.hasOwn(table, v);
const THEMES: Record<UserPreferences['theme'], true> = { light: true, dark: true, system: true };
const COLUMN_WIDTHS: Record<UserPreferences['reader']['columnWidth'], true> = { narrow: true, medium: true, wide: true };
const DENSITIES: Record<UserPreferences['reader']['density'], true> = { compact: true, normal: true, relaxed: true };
const BOOK_IDS = new Set(BOOKS.map((b) => b.osisId));

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArray = (v: unknown) => Array.isArray(v) && v.every(isStr);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);

function annotationProblem(a: Rec): string | null {
    if (!isKey(ANNOTATION_TYPES, a.type)) return `unknown type ${JSON.stringify(a.type)}`;
    if (!isStr(a.book) || !BOOK_IDS.has(a.book)) return `unknown book ${JSON.stringify(a.book)}`;
    for (const key of ['verseStart', 'verseEnd'] as const) {
        const ref = isStr(a[key]) ? parseOsisId(a[key]) : undefined;
        if (!ref) return `${key} ${JSON.stringify(a[key])} is not a verse reference like Gen.1.1`;
        if (ref.book !== a.book) return `${key} ${a[key]} is not in ${a.book}`;
    }
    if (!isStr(a.data)) return 'data is not text';
    if (!isStrArray(a.tags)) return 'tags is not a list of text';
    if (!isNum(a.created) || !isNum(a.modified)) return 'created or modified is not a timestamp';
    if (!optional(a.color, isStr) || !optional(a.translation, isStr)) return 'color or translation is not text';
    if (!optional(a.synced, (v) => typeof v === 'boolean')) return 'synced is not true or false';
    return null;
}

function tagProblem(t: Rec): string | null {
    if (!isStr(t.name) || !isStr(t.color)) return 'name or color is not text';
    if (!optional(t.modified, isNum)) return 'modified is not a timestamp';
    return null;
}

function searchProblem(s: Rec): string | null {
    if (!isStr(s.query)) return 'query is not text';
    if (!isStrArray(s.translationIds)) return 'translationIds is not a list of text';
    if (!isKey(TESTAMENTS, s.testamentFilter)) return `unknown testamentFilter ${JSON.stringify(s.testamentFilter)}`;
    if (!isNum(s.created) || !optional(s.modified, isNum)) return 'created or modified is not a timestamp';
    if (!optional(s.mode, (v) => isKey(SEARCH_MODES, v))) return `unknown mode ${JSON.stringify(s.mode)}`;
    if (!optional(s.includeVariants, (v) => typeof v === 'boolean')) return 'includeVariants is not true or false';
    return null;
}

/** The fields the app reads without a fallback: a bad value here breaks the reader or Settings after a replace. */
function settingsProblem(p: Rec): string | null {
    if (!isStr(p.activeTranslation)) return 'activeTranslation is not text';
    if (!isKey(THEMES, p.theme)) return `unknown theme ${JSON.stringify(p.theme)}`;
    if (!isStr(p.accentColor)) return 'accentColor is not text';
    const f = p.fonts;
    if (!isObj(f) || ![f.ui, f.reader, f.greek, f.hebrew].every(isStr) || !isNum(f.size)) return 'fonts is incomplete';
    const r = p.reader;
    if (
        !isObj(r) || !isNum(r.lineHeight) || !isKey(COLUMN_WIDTHS, r.columnWidth) || !isKey(DENSITIES, r.density) ||
        ![r.showVerseNumbers, r.showRedLetters, r.paragraphMode].every((v) => typeof v === 'boolean')
    ) return 'reader options are incomplete';
    if (!Array.isArray(p.highlightPresets) || !p.highlightPresets.every((h) => isObj(h) && isStr(h.id) && isStr(h.name) && isStr(h.color))) {
        return 'highlightPresets is not a list of presets';
    }
    return null;
}

function scratchPadProblem(s: Rec): string | null {
    if (!isStr(s.content)) return 'content is not text';
    if (!Array.isArray(s.droppedVerses) || !s.droppedVerses.every((b) => isObj(b) && [b.osisId, b.translationId, b.text, b.reference].every(isStr))) {
        return 'droppedVerses is not a list of verse blocks';
    }
    if (!optional(s.modified, isNum)) return 'modified is not a timestamp';
    return null;
}

const RECORD_LISTS = [
    { key: 'annotations', label: 'Annotation', check: annotationProblem },
    { key: 'tags', label: 'Tag', check: tagProblem },
    { key: 'savedSearches', label: 'Saved search', check: searchProblem },
] as const;

/**
 * Parse and validate every record before anything is written; throws a
 * readable message for the user. Unknown fields are kept as they are, so
 * a file from a newer build that only added fields still imports.
 */
export function parseBackup(text: string): Backup {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error('That file is not JSON.');
    }
    if (!isObj(raw)) throw new Error('That file is not a backup.');
    if (raw.format !== BACKUP_FORMAT) throw new Error('That file is not a Codex Scriptura backup.');
    if (!isNum(raw.version) || raw.version > BACKUP_VERSION) {
        throw new Error(`This backup was written by a newer version (format ${raw.version}); update the app first.`);
    }
    for (const { key } of RECORD_LISTS) {
        if (!Array.isArray(raw[key])) throw new Error(`The backup is missing its ${key}.`);
    }
    if (!isObj(raw.settings)) throw new Error('The backup is missing its settings.');

    const problems: string[] = [];
    for (const { key, label, check } of RECORD_LISTS) {
        const seen = new Set<string>();
        (raw[key] as unknown[]).forEach((rec, i) => {
            const where = `${label} ${i + 1}`;
            if (!isObj(rec)) return problems.push(`${where} is not a record.`);
            if (!isStr(rec.id) || rec.id === '') return problems.push(`${where} has no id.`);
            if (seen.has(rec.id)) return problems.push(`${where} (${rec.id}) repeats an id used earlier in the file.`);
            seen.add(rec.id);
            const why = check(rec);
            if (why) problems.push(`${where} (${rec.id}): ${why}.`);
        });
    }
    const settingsWhy = settingsProblem(raw.settings);
    if (settingsWhy) problems.push(`Settings: ${settingsWhy}.`);
    if (raw.scratchPad !== undefined) {
        const padWhy = isObj(raw.scratchPad) ? scratchPadProblem(raw.scratchPad) : 'not a record';
        if (padWhy) problems.push(`Scratch pad: ${padWhy}.`);
    }
    if (problems.length > 0) throw new BackupValidationError(problems);
    return raw as Backup;
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
        scratchPad: b.scratchPad !== undefined,
    };
}

// ─── Merge plan ───────────────────────────────────────────

/** What this browser holds now, read before planning. */
export type LocalState = {
    annotations: Annotation[];
    tags: Tag[];
    savedSearches: SavedSearch[];
    scratchPad?: ScratchPadState;
};

export type Collision<T> = { local: T; incoming: T };

/** One record type, every backup record in exactly one of the first four buckets. */
export type TypePlan<T> = {
    /** No local record with this id. */
    added: T[];
    /** The backup copy is newer; merge overwrites the local one. */
    newer: Collision<T>[];
    /** The local copy is newer; merge keeps it. Replace overwrites it with the older backup copy. */
    older: Collision<T>[];
    /** Same timestamp on both sides; merge writes nothing. */
    same: Collision<T>[];
    /** Local records the backup does not have; merge keeps them, replace deletes them. */
    localOnly: T[];
    /** What the import writes for this type. */
    write: T[];
};

export type ImportPlan = {
    mode: 'merge' | 'replace';
    annotations: TypePlan<Annotation>;
    tags: TypePlan<Tag>;
    savedSearches: TypePlan<SavedSearch>;
    /** Settings to write, or null to keep the local ones. Merge keeps local settings; replace takes the backup's. */
    settings: UserPreferences | null;
    /** The scratch pad to write, or null to keep the local one. */
    scratchPad: ScratchPadState | null;
};

export const modifiedAt = {
    annotation: (a: Annotation) => a.modified,
    tag: (t: Tag) => t.modified ?? 0,
    savedSearch: (s: SavedSearch) => s.modified ?? s.created,
    scratchPad: (p: ScratchPadState) => p.modified ?? 0,
};

function planType<T extends { id: string }>(incoming: T[], local: T[], modified: (r: T) => number, mode: ImportPlan['mode']): TypePlan<T> {
    const byId = new Map(local.map((r) => [r.id, r]));
    const plan: TypePlan<T> = { added: [], newer: [], older: [], same: [], localOnly: [], write: [] };
    for (const rec of incoming) {
        const here = byId.get(rec.id);
        if (!here) plan.added.push(rec);
        else {
            byId.delete(rec.id);
            const d = modified(rec) - modified(here);
            (d > 0 ? plan.newer : d < 0 ? plan.older : plan.same).push({ local: here, incoming: rec });
        }
    }
    plan.localOnly = [...byId.values()];
    plan.write = mode === 'replace' ? incoming : [...plan.added, ...plan.newer.map((c) => c.incoming)];
    return plan;
}

const padIsEmpty = (p: ScratchPadState) => p.content.trim() === '' && p.droppedVerses.length === 0;

/**
 * Merge is last-write-wins per record by `modified`: a backup record is
 * written only when this browser lacks it or holds an older copy, and a
 * tie writes nothing. Records deleted here come back if the backup still
 * has them; there are no deletion markers until sync (#62).
 * Replace makes the backup the whole truth for every record type (the
 * caller clears the tables first), except the scratch pad when the file
 * has none.
 */
export function planImport(b: Backup, mode: ImportPlan['mode'], local: LocalState): ImportPlan {
    let scratchPad: ScratchPadState | null = null;
    if (b.scratchPad) {
        const here = local.scratchPad;
        const takeBackup =
            mode === 'replace' || !here ||
            modifiedAt.scratchPad(b.scratchPad) > modifiedAt.scratchPad(here) ||
            (modifiedAt.scratchPad(b.scratchPad) === modifiedAt.scratchPad(here) && padIsEmpty(here) && !padIsEmpty(b.scratchPad));
        if (takeBackup) scratchPad = b.scratchPad;
    }
    return {
        mode,
        annotations: planType(b.annotations, local.annotations, modifiedAt.annotation, mode),
        tags: planType(b.tags, local.tags, modifiedAt.tag, mode),
        savedSearches: planType(b.savedSearches, local.savedSearches, modifiedAt.savedSearch, mode),
        settings: mode === 'replace' ? b.settings : null,
        scratchPad,
    };
}
