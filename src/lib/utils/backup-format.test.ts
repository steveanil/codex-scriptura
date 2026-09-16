import { describe, expect, it } from 'vitest';
import type { Annotation, UserPreferences } from '@codex-scriptura/core';
import { BACKUP_FORMAT, backupFilename, buildBackup, parseBackup, planImport, summarize } from './backup-format';

const settings = { id: 'default', activeTranslation: 'KJV' } as UserPreferences;
const ann = (id: string, type: Annotation['type']): Annotation =>
    ({ id, type, book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.1', data: '', tags: [], created: 1, modified: 1, synced: false }) as Annotation;

const sample = buildBackup({
    app: '2026-09-14',
    settings,
    annotations: [ann('a', 'note'), ann('b', 'highlight'), ann('c', 'theme')],
    tags: [{ id: 't1', name: 'x', color: '#000' }],
    savedSearches: [],
}, 1000);

describe('backup format', () => {
    it('round-trips through JSON', () => {
        const parsed = parseBackup(JSON.stringify(sample));
        expect(parsed.format).toBe(BACKUP_FORMAT);
        expect(parsed.annotations).toHaveLength(3);
    });
    it('summarizes by annotation type', () => {
        expect(summarize(sample)).toMatchObject({ annotations: 3, notes: 1, highlights: 1, themes: 1, tags: 1, savedSearches: 0, exportedAt: 1000 });
    });
    it('names the file by date', () => {
        expect(backupFilename(new Date('2026-09-16T10:00:00Z'))).toBe('codex-scriptura-backup-2026-09-16.json');
    });
    it('rejects non-JSON, foreign files and newer formats with readable messages', () => {
        expect(() => parseBackup('nope')).toThrow(/not JSON/);
        expect(() => parseBackup('{"hello":1}')).toThrow(/not a Codex Scriptura backup/);
        expect(() => parseBackup(JSON.stringify({ ...sample, version: 99 }))).toThrow(/newer version/);
        expect(() => parseBackup(JSON.stringify({ ...sample, annotations: [{ id: 1 }] }))).toThrow(/malformed/);
        expect(() => parseBackup(JSON.stringify({ ...sample, tags: undefined }))).toThrow(/missing its tags/);
    });
});

describe('planImport', () => {
    const local = { annotationIds: new Set(['a', 'zzz']), tagIds: new Set<string>(), searchIds: new Set<string>() };
    it('merge keeps local settings and counts collisions', () => {
        const plan = planImport(sample, 'merge', local);
        expect(plan.settings).toBeNull();
        expect(plan.overwritten).toBe(1);
        expect(plan.annotations).toHaveLength(3);
    });
    it('replace takes the backup settings', () => {
        const plan = planImport(sample, 'replace', local);
        expect(plan.settings).toBe(settings);
        expect(plan.overwritten).toBe(0);
    });
});
