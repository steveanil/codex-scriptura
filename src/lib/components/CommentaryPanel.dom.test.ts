// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { commentaryBlockKeys, toCommentaryEntry, type DatasetManifest, type RawCommentaryEntry } from '@codex-scriptura/core';
import { db, type getCommentaryForChapter as GetChapter } from '@codex-scriptura/db';
import { datasetStatus } from '$lib/stores/datasetStatus.svelte';
import CommentaryPanel from './CommentaryPanel.svelte';

vi.mock('$lib/seed', () => ({ retryDataset: vi.fn() }));
let manifest: DatasetManifest | null = null;
vi.mock('$lib/data-manifest', async (original) => ({ ...(await original<typeof import('$lib/data-manifest')>()), getDataManifest: async () => manifest }));
// A test can stand in for the chapter query to hold it pending or make it fail; otherwise the real one runs
let chapterQuery: typeof GetChapter | null = null;
vi.mock('@codex-scriptura/db', async (original) => {
    const real = await original<typeof import('@codex-scriptura/db')>();
    return { ...real, getCommentaryForChapter: (...a: Parameters<typeof GetChapter>) => (chapterQuery ?? real.getCommentaryForChapter)(...a) };
});

const DATASET = 'commentary:catena-aurea', RESOURCE = 'catena-aurea';
const resource = (id: string, title: string) => ({
    id, type: 'commentary', title, author: 'Thomas Aquinas', publisher: 'J. H. Parker, Oxford, 1841', language: 'en',
    license: { spdx: 'public-domain', name: 'Public domain' },
    provenance: [{ sourceId: 'catena-1841-john-1', name: 'Catena Aurea, Oxford 1841', url: 'https://archive.org/details/catenaaureacomme04thomuoft', license: 'public-domain' }],
    version: 'v1',
});
const dataset = (id: string, resourceId: string) => ({ id, version: 'v1', contentHash: 'a'.repeat(64), recordCount: 2, files: [`${id}.json`], resourceId, contentFormat: 'codex-commentary-markdown/1' });
const asManifest = (pairs: [string, string, string][]) => ({ datasets: pairs.map(([d, r]) => dataset(d, r)), resources: pairs.map(([, r, t]) => resource(r, t)) }) as unknown as DatasetManifest;

const first = '> In the beginning was the Word.\n\n**Chrysostom.** (*Chrys. Hom. iv.*) Because it is an especial attribute of God.\n\n**Bede.** As if to say.';
const second = '> In him was life.\n\n**Origen.** (*Orig. t. ii. c. 12.*) Life here is not the life common to all.';
const raw: RawCommentaryEntry[] = [
    { id: 'catena-john-1-1', startRef: 'John.1.1', endRef: 'John.1.2', content: first, source: { item: 'catenaaureacomme04thomuoft', leafStart: 14, leafEnd: 15, pageStart: '5' },
        excerpts: [{ key: commentaryBlockKeys(first)[1], leaf: 14, citation: 'checked', reviewed: '2026-11-14', reviewer: 'ai' }, { key: commentaryBlockKeys(first)[2], leaf: 15 }] },
    { id: 'catena-john-1-4', startRef: 'John.1.4', endRef: 'John.1.4', content: second, source: { item: 'catenaaureacomme04thomuoft', leafStart: 22, leafEnd: 27 },
        excerpts: [{ key: commentaryBlockKeys(second)[1], leaf: 26, citation: 'unverified' }] },
];
const receipt = (id: string) => db.datasets.put({ id, version: 'v1', contentHash: 'a'.repeat(64), installedAt: 1, recordCount: 2, resourceId: RESOURCE });
const mount = (props: Record<string, unknown> = {}) => render(CommentaryPanel, { bookId: 'John', bookName: 'John', chapter: 1, ...props });
const refs = (c: HTMLElement) => [...c.querySelectorAll('.entry')].map((e) => e.getAttribute('data-entry'));

beforeEach(async () => {
    manifest = asManifest([[DATASET, RESOURCE, 'Catena Aurea']]);
    datasetStatus.watch();
    datasetStatus.setPhase('done');
    await db.commentaryEntries.clear();
    await db.datasets.clear();
    await db.resources.clear();
    await db.commentaryEntries.bulkPut(raw.map((e) => toCommentaryEntry(e, RESOURCE)));
});
afterEach(() => { cleanup(); chapterQuery = null; });

describe('CommentaryPanel (issue #366)', () => {
    it('shows the chapter\'s entries of the installed commentary, with its author, source and licence', async () => {
        await receipt(DATASET);
        const { container } = mount();
        await vi.waitFor(() => expect(refs(container)).toEqual(['catena-john-1-1', 'catena-john-1-4']));
        expect(container.querySelector('.resource h3')?.textContent).toBe('Catena Aurea');
        const head = container.querySelector('.resource')!.textContent!;
        expect(head).toContain('Thomas Aquinas');
        expect(head).toContain('Public domain');
        expect(container.querySelector('.resource a')?.getAttribute('href')).toBe('https://archive.org/details/catenaaureacomme04thomuoft');
        expect([...container.querySelectorAll('.entry-ref span')].map((s) => s.textContent)).toEqual(['John 1:1-2', 'John 1:4']);
        expect(container.querySelector('.entry strong')?.textContent).toBe('Chrysostom.');
    });

    it('with no manifest to fetch, lists the commentaries installed on the device', async () => {
        manifest = null;
        await db.resources.put(resource(RESOURCE, 'Catena Aurea') as never);
        await receipt(DATASET);
        const { container } = mount();
        await vi.waitFor(() => expect(refs(container)).toEqual(['catena-john-1-1', 'catena-john-1-4']));
        expect(container.querySelector('.resource h3')?.textContent).toBe('Catena Aurea');
        expect(container.textContent).not.toContain('carries no commentary');
    });

    it('with no manifest and nothing installed, says the build carries no commentary', async () => {
        manifest = null;
        await db.resources.clear();
        const { container } = mount();
        await vi.waitFor(() => expect(container.textContent).toContain('This build carries no commentary yet.'));
    });

    it('says once that citations are OCR readings unless marked, and marks each one', async () => {
        await receipt(DATASET);
        const { container } = mount();
        await vi.waitFor(() => expect(refs(container)).toHaveLength(2));
        expect(container.querySelectorAll('.provenance-note')).toHaveLength(1);
        expect(container.querySelector('.provenance-note')!.textContent).toContain('unless it is marked as checked against the page');
        expect([...container.querySelectorAll('.excerpt-meta')].map((m) => m.getAttribute('data-citation'))).toEqual(['checked', 'none', 'unverified']);
        expect([...container.querySelectorAll('.page-link')].map((a) => a.getAttribute('href'))).toEqual([14, 15, 26].map((n) => `https://archive.org/details/catenaaureacomme04thomuoft/page/n${n}`));
        // The entry's own link opens the first scanned page of the passage
        expect(container.querySelector('.entry-ref a')?.getAttribute('href')).toBe('https://archive.org/details/catenaaureacomme04thomuoft/page/n14');
    });

    it('narrows to the entries that cover the selected verses, and follows the chapter without a reload', async () => {
        await receipt(DATASET);
        const { container, rerender } = mount({ selectedVerses: [2] });
        await vi.waitFor(() => expect(refs(container)).toEqual(['catena-john-1-1']));
        await rerender({ selectedVerses: [4, 9] });
        await vi.waitFor(() => expect(refs(container)).toEqual(['catena-john-1-4']));
        await rerender({ selectedVerses: [9] });
        await vi.waitFor(() => expect(container.textContent).toContain('Nothing in this commentary covers the selected verses of John 1.'));
        await rerender({ selectedVerses: [], chapter: 2 });
        await vi.waitFor(() => expect(container.textContent).toContain('This commentary has nothing on John 2.'));
        expect(refs(container)).toEqual([]);
        await rerender({ chapter: 1 });
        await vi.waitFor(() => expect(refs(container)).toHaveLength(2));
    });

    it('reads nothing until the dataset receipt is present, even with rows in the table', async () => {
        const { container } = mount();
        await vi.waitFor(() => expect(container.querySelector('.resource h3')).not.toBeNull());
        expect(refs(container)).toEqual([]);
        await receipt(DATASET);
        await vi.waitFor(() => expect(refs(container)).toHaveLength(2));
    });

    it('offers a choice when more than one commentary is in the catalogue, and keeps their entries apart', async () => {
        manifest = asManifest([[DATASET, RESOURCE, 'Catena Aurea'], ['commentary:haydock', 'haydock', 'Haydock']]);
        await db.commentaryEntries.put(toCommentaryEntry({ id: 'haydock-john-1-1', startRef: 'John.1.1', endRef: 'John.1.1', content: 'Ver. 1. In the beginning.' }, 'haydock'));
        await receipt(DATASET);
        await receipt('commentary:haydock');
        const { container } = mount();
        await vi.waitFor(() => expect(refs(container)).toEqual(['catena-john-1-1', 'catena-john-1-4']));
        const select = container.querySelector('select')!;
        expect([...select.options].map((o) => o.textContent)).toEqual(['Catena Aurea', 'Haydock']);
        select.value = 'haydock';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => expect(refs(container)).toEqual(['haydock-john-1-1']));
        expect(container.querySelector('.provenance-note')).toBeNull();
    });

    it('says so plainly when the build carries no commentary', async () => {
        manifest = asManifest([]);
        const { container } = mount();
        await vi.waitFor(() => expect(container.textContent).toContain('This build carries no commentary yet.'));
    });

    it('never shows one chapter\'s entries under another while the next chapter is still being read', async () => {
        await receipt(DATASET);
        const { container, rerender } = mount();
        await vi.waitFor(() => expect(refs(container)).toHaveLength(2));
        let release!: () => void;
        chapterQuery = () => new Promise((resolve) => { release = () => resolve([]); });
        await rerender({ chapter: 2 });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        expect(refs(container)).toEqual([]);
        expect(container.textContent).not.toContain('This commentary has nothing on');
        release();
        await vi.waitFor(() => expect(container.textContent).toContain('This commentary has nothing on John 2.'));
    });

    it('says plainly when the chapter cannot be read, and shows nothing of the chapter before', async () => {
        await receipt(DATASET);
        const { container, rerender } = mount();
        await vi.waitFor(() => expect(refs(container)).toHaveLength(2));
        chapterQuery = () => Promise.reject(new Error('IndexedDB is closed'));
        await rerender({ chapter: 2 });
        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('The commentary on John 2 could not be read.'));
        expect(refs(container)).toEqual([]);
    });

    it('says plainly when the commentary list cannot be read, instead of loading for ever', async () => {
        manifest = null;
        const spy = vi.spyOn(db.resources, 'toArray').mockRejectedValueOnce(new Error('IndexedDB is closed'));
        const { container } = mount();
        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('The commentary list could not be read.'));
        expect(container.textContent).not.toContain('Loading the commentary list');
        spy.mockRestore();
    });
});
