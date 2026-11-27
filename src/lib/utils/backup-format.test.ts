import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Annotation, SavedSearch, ScratchPadState, Tag } from '@codex-scriptura/core';
import { BACKUP_FORMAT, BackupValidationError, backupFilename, buildBackup, parseBackup, planImport, summarize, type Backup, type LocalState } from './backup-format';

const settings = JSON.parse(readFileSync(new URL('./fixtures/backup-v1.json', import.meta.url), 'utf8')).settings;
const ann = (id: string, type: Annotation['type'], modified = 1, data = ''): Annotation =>
    ({ id, type, book: 'Gen', verseStart: 'Gen.1.1', verseEnd: 'Gen.1.1', data, tags: [], created: 1, modified, synced: false });
const tag = (id: string, modified?: number): Tag => ({ id, name: id, color: '#000', ...(modified !== undefined ? { modified } : {}) });
const search = (id: string, created: number, modified?: number): SavedSearch =>
    ({ id, query: id, translationIds: ['KJV'], testamentFilter: 'all', created, ...(modified !== undefined ? { modified } : {}) });
const pad = (content: string, modified?: number): ScratchPadState => ({ content, droppedVerses: [], ...(modified !== undefined ? { modified } : {}) });
const empty: LocalState = { annotations: [], tags: [], savedSearches: [] };

const sample = buildBackup({
    app: '2026-09-14',
    settings,
    annotations: [ann('a', 'note'), ann('b', 'highlight'), ann('c', 'theme')],
    tags: [tag('t1')],
    savedSearches: [],
}, 1000);

const parseWith = (patch: Partial<Record<keyof Backup, unknown>>) => () => parseBackup(JSON.stringify({ ...sample, ...patch }));

describe('backup format', () => {
    it('round-trips through JSON', () => {
        const parsed = parseBackup(JSON.stringify(sample));
        expect(parsed.format).toBe(BACKUP_FORMAT);
        expect(parsed.annotations).toHaveLength(3);
    });
    it('summarizes by annotation type', () => {
        expect(summarize(sample)).toMatchObject({ annotations: 3, notes: 1, highlights: 1, themes: 1, tags: 1, savedSearches: 0, exportedAt: 1000, scratchPad: false });
    });
    it('names the file by date', () => {
        expect(backupFilename(new Date('2026-09-16T10:00:00Z'))).toBe('codex-scriptura-backup-2026-09-16.json');
    });
    it('rejects non-JSON, foreign files and newer formats with readable messages', () => {
        expect(() => parseBackup('nope')).toThrow(/not JSON/);
        expect(() => parseBackup('{"hello":1}')).toThrow(/not a Codex Scriptura backup/);
        expect(parseWith({ version: 99 })).toThrow(/newer version/);
        expect(parseWith({ tags: undefined })).toThrow(/missing its tags/);
    });
});

describe('the frozen version-1 file', () => {
    // Written by the develop build's exporter before this format had
    // per-record timestamps on tags, saved searches or a scratch pad. Never
    // edit it: it stands for every file a user already has on disk.
    const text = readFileSync(new URL('./fixtures/backup-v1.json', import.meta.url), 'utf8');

    it('imports with the current parser', () => {
        const b = parseBackup(text);
        expect(b.version).toBe(1);
        expect(b.annotations.length).toBeGreaterThan(0);
        const plan = planImport(b, 'merge', empty);
        expect(plan.annotations.added).toHaveLength(b.annotations.length);
        expect(plan.tags.added).toHaveLength(b.tags.length);
        expect(plan.savedSearches.added).toHaveLength(b.savedSearches.length);
        expect(plan.scratchPad).toBeNull();
    });

    it('still imports when records and the document gain fields, and keeps them', () => {
        const raw = JSON.parse(text);
        raw.annotations = raw.annotations.map((a: Annotation) => ({ ...a, anchor: { datasetVersion: 'kjv-r2', selector: { exact: 'beginning' } } }));
        raw.tags = raw.tags.map((t: Tag) => ({ ...t, modified: 5, parent: null }));
        raw.futureSection = [{ id: 'x' }];
        const b = parseBackup(JSON.stringify(raw)) as Backup & { futureSection: unknown };
        expect((b.annotations[0] as Annotation & { anchor: unknown }).anchor).toEqual({ datasetVersion: 'kjv-r2', selector: { exact: 'beginning' } });
        expect(b.futureSection).toEqual([{ id: 'x' }]);
    });
});

describe('per-record validation', () => {
    const problemsOf = (fn: () => unknown): string[] => {
        try {
            fn();
        } catch (err) {
            if (err instanceof BackupValidationError) return err.problems;
            throw err;
        }
        throw new Error('expected a validation error');
    };

    it('names the record and the reason for a malformed annotation', () => {
        const bad = [
            { ...ann('n1', 'note'), type: 'scribble' },
            { ...ann('n2', 'note'), verseStart: 'Genesis 1:1' },
            { ...ann('n3', 'note'), verseEnd: 'Exod.1.1' },
            { ...ann('n4', 'note'), book: 'Narnia' },
            { ...ann('n5', 'note'), data: 4 },
            { ...ann('n6', 'note'), tags: 'x' },
            { ...ann('n7', 'note'), modified: '2026' },
            { ...ann('', 'note') },
            'not a record',
        ];
        const problems = problemsOf(parseWith({ annotations: [ann('ok', 'note'), ...bad] }));
        expect(problems).toEqual([
            'Annotation 2 (n1): unknown type "scribble".',
            'Annotation 3 (n2): verseStart "Genesis 1:1" is not a verse reference like Gen.1.1.',
            'Annotation 4 (n3): verseEnd Exod.1.1 is not in Gen.',
            'Annotation 5 (n4): unknown book "Narnia".',
            'Annotation 6 (n5): data is not text.',
            'Annotation 7 (n6): tags is not a list of text.',
            'Annotation 8 (n7): created or modified is not a timestamp.',
            'Annotation 9 has no id.',
            'Annotation 10 is not a record.',
        ]);
    });

    it('rejects a malformed tag', () => {
        expect(problemsOf(parseWith({ tags: [{ id: 't', name: 'x' }] }))).toEqual(['Tag 1 (t): name or color is not text.']);
        expect(problemsOf(parseWith({ tags: [{ ...tag('t'), modified: 'yesterday' }] }))).toEqual(['Tag 1 (t): modified is not a timestamp.']);
    });

    it('rejects a malformed saved search', () => {
        expect(problemsOf(parseWith({ savedSearches: [{ ...search('s', 1), testamentFilter: 'Gospels' }] }))).toEqual(['Saved search 1 (s): unknown testamentFilter "Gospels".']);
        expect(problemsOf(parseWith({ savedSearches: [{ ...search('s', 1), translationIds: 'KJV' }] }))).toEqual(['Saved search 1 (s): translationIds is not a list of text.']);
    });

    it('rejects settings the app could not run on', () => {
        expect(problemsOf(parseWith({ settings: { ...settings, theme: 'sepia' } }))).toEqual(['Settings: unknown theme "sepia".']);
        expect(problemsOf(parseWith({ settings: { ...settings, reader: { lineHeight: 2 } } }))).toEqual(['Settings: reader options are incomplete.']);
        expect(problemsOf(parseWith({ settings: { ...settings, reader: { ...settings.reader, showFootnotes: 'yes' } } }))).toEqual(['Settings: reader options are incomplete.']);
    });

    it('keeps the optional footnotes preference without a format change (issue #39)', () => {
        const off = { ...settings, reader: { ...settings.reader, showFootnotes: false } };
        expect(parseBackup(JSON.stringify({ ...sample, settings: off })).settings.reader.showFootnotes).toBe(false);
        expect(settings.reader.showFootnotes).toBeUndefined();
        expect(parseBackup(JSON.stringify(sample)).settings.reader.showFootnotes).toBeUndefined();
    });

    it('rejects a malformed scratch pad', () => {
        expect(problemsOf(parseWith({ scratchPad: { content: 3, droppedVerses: [] } }))).toEqual(['Scratch pad: content is not text.']);
    });

    it('rejects an id repeated within one type', () => {
        expect(problemsOf(parseWith({ tags: [tag('t'), tag('u'), tag('t')] }))).toEqual(['Tag 3 (t) repeats an id used earlier in the file.']);
    });

    it('reports how many problems there are and the first one in its message', () => {
        expect(parseWith({ tags: [{ id: 't' }, { id: 'u' }] })).toThrow('The backup has 2 problems, so nothing was imported. The first: Tag 1 (t): name or color is not text.');
    });
});

describe('planImport, merge', () => {
    const backup = buildBackup({
        app: 'x', settings,
        annotations: [ann('new', 'note', 5), ann('newer', 'note', 9, 'backup'), ann('older', 'note', 2, 'backup'), ann('same', 'note', 4)],
        tags: [tag('t-untimed'), tag('t-newer', 3)],
        savedSearches: [search('s-created', 10), search('s-old', 1, 2)],
    });
    const local: LocalState = {
        annotations: [ann('newer', 'note', 3, 'local'), ann('older', 'note', 8, 'local'), ann('same', 'note', 4), ann('mine', 'highlight', 1)],
        tags: [tag('t-untimed'), tag('t-newer')],
        savedSearches: [search('s-created', 5), search('s-old', 1, 7)],
    };
    const plan = planImport(backup, 'merge', local);

    it('puts every backup record in exactly one bucket by modified', () => {
        const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
        const pairIds = (xs: { incoming: { id: string } }[]) => xs.map((x) => x.incoming.id);
        expect(ids(plan.annotations.added)).toEqual(['new']);
        expect(pairIds(plan.annotations.newer)).toEqual(['newer']);
        expect(pairIds(plan.annotations.older)).toEqual(['older']);
        expect(pairIds(plan.annotations.same)).toEqual(['same']);
        expect(ids(plan.annotations.localOnly)).toEqual(['mine']);
    });

    it('writes only new records and records the backup holds a newer copy of', () => {
        expect(plan.annotations.write.map((a) => `${a.id}:${a.data}`)).toEqual(['new:', 'newer:backup']);
    });

    it('never overwrites a newer local record, and a tie writes nothing', () => {
        expect(plan.annotations.write.find((a) => a.id === 'older')).toBeUndefined();
        expect(plan.annotations.write.find((a) => a.id === 'same')).toBeUndefined();
        expect(plan.annotations.older[0].local.data).toBe('local');
    });

    it('reads an untimed tag as 0 and an untimed saved search as its created time', () => {
        expect(plan.tags.same.map((c) => c.incoming.id)).toEqual(['t-untimed']);
        expect(plan.tags.newer.map((c) => c.incoming.id)).toEqual(['t-newer']);
        expect(plan.savedSearches.newer.map((c) => c.incoming.id)).toEqual(['s-created']);
        expect(plan.savedSearches.older.map((c) => c.incoming.id)).toEqual(['s-old']);
    });

    it('keeps local settings', () => {
        expect(plan.settings).toBeNull();
    });
});

describe('planImport, replace', () => {
    const backup = buildBackup({ app: 'x', settings, annotations: [ann('older', 'note', 2)], tags: [], savedSearches: [] });
    const plan = planImport(backup, 'replace', { ...empty, annotations: [ann('older', 'note', 8), ann('mine', 'note')] });

    it('writes the whole backup, even over a newer local copy, and lists what it removes', () => {
        expect(plan.annotations.write.map((a) => a.id)).toEqual(['older']);
        expect(plan.annotations.older).toHaveLength(1);
        expect(plan.annotations.localOnly.map((a) => a.id)).toEqual(['mine']);
    });

    it('takes the backup settings', () => {
        expect(plan.settings).toBe(settings);
    });
});

describe('planImport, scratch pad', () => {
    const withPad = (p?: ScratchPadState) => buildBackup({ app: 'x', settings, annotations: [], tags: [], savedSearches: [], ...(p ? { scratchPad: p } : {}) });
    const merge = (incoming?: ScratchPadState, here?: ScratchPadState) => planImport(withPad(incoming), 'merge', { ...empty, scratchPad: here }).scratchPad;

    it('takes the newer pad and keeps the local one on a tie or when it is newer', () => {
        expect(merge(pad('backup', 5), pad('local', 3))?.content).toBe('backup');
        expect(merge(pad('backup', 3), pad('local', 5))).toBeNull();
        expect(merge(pad('backup', 3), pad('local', 3))).toBeNull();
    });

    it('fills a missing or empty local pad, and leaves it alone when the file has none', () => {
        expect(merge(pad('backup'), undefined)?.content).toBe('backup');
        expect(merge(pad('backup'), pad(''))?.content).toBe('backup');
        expect(merge(pad(''), pad('local'))).toBeNull();
        expect(merge(undefined, pad('local'))).toBeNull();
    });

    it('replace takes the backup pad, but keeps the local one when the file has none', () => {
        expect(planImport(withPad(pad('backup', 1)), 'replace', { ...empty, scratchPad: pad('local', 9) }).scratchPad?.content).toBe('backup');
        expect(planImport(withPad(), 'replace', { ...empty, scratchPad: pad('local', 9) }).scratchPad).toBeNull();
    });
});
