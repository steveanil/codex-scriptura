/**
 * TEMPORARY (issue #166): proves the indexed engines return exactly what
 * the full-scan engines on develop returned. Delete with
 * legacy-engine.fixture.ts once established.
 *
 * The fixture corpus always runs. `LEGACY_CORPUS=1` also runs every query
 * over the real tagged translations in data/processed (not in git).
 */

import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { findBook, strongsIndexDatasetId, translationDatasetId } from '@codex-scriptura/core';
import type { VerseRecord } from '@codex-scriptura/core';
import { db, strongsSearch } from '@codex-scriptura/db';
import { strongsPostings } from '../../../packages/data-pipeline/src/importers/build-strongs-index';
import { searchWord, searchWordByLemma } from './concordance';
import { buildWordPattern } from './config';
import { heldIndexes, releaseIndex } from './index-manager';
import { legacyBuildWordPattern, legacyLemmaGroupSearch, legacyStrongsSearch, legacyWordSearch } from './legacy-engine.fixture';

type Raw = { osisId: string; text: string; lemmas?: string; align?: string };
const TESTAMENTS = ['all', 'OT', 'NT', 'AP'] as const;

async function install(translationId: string, raw: Raw[]) {
    const verses = raw.map((v) => {
        const [book, chapter, verse] = v.osisId.split('.');
        return { ...v, id: `${translationId}.${v.osisId}`, translationId, book, chapter: +chapter, verse: +verse } as VerseRecord;
    });
    await db.transaction('rw', [db.verses, db.datasets, db.strongsPostings, db.searchIndexes], async () => {
        await db.verses.where('translationId').equals(translationId).delete();
        await db.strongsPostings.where('translationId').equals(translationId).delete();
        await db.searchIndexes.clear();
    });
    for (let i = 0; i < verses.length; i += 5000) await db.verses.bulkPut(verses.slice(i, i + 5000));
    await db.strongsPostings.bulkPut(strongsPostings(raw).map((p) => ({ translationId, ...p })));
    const receipt = { version: 'eq', contentHash: `eq-${raw.length}`, installedAt: 0, recordCount: raw.length };
    await db.datasets.bulkPut([{ id: translationDatasetId(translationId), ...receipt }, { id: strongsIndexDatasetId(translationId), ...receipt }]);
    releaseIndex(translationId);
}

const inTestament = (t: (typeof TESTAMENTS)[number]) => (r: { verse: VerseRecord }) => t === 'all' || findBook(r.verse.book)?.testament === t;

async function expectWordEquivalent(translationId: string, query: string) {
    for (const variants of [false, true]) {
        const legacyPattern = legacyBuildWordPattern(query, variants);
        const label = `${translationId} "${query}" variants=${variants}`;
        if (!legacyPattern) {
            expect(buildWordPattern(query, variants), label).toBeNull();
            continue;
        }
        const legacyFlat = await legacyWordSearch(translationId, legacyPattern);
        for (const testament of TESTAMENTS) {
            expect(await searchWord(translationId, query, variants, testament), `${label} ${testament} flat`).toEqual(legacyFlat.filter(inTestament(testament)));
            expect(await searchWordByLemma(translationId, query, variants, testament), `${label} ${testament} grouped`)
                .toEqual(await legacyLemmaGroupSearch(translationId, legacyPattern, testament));
        }
    }
}

async function expectStrongsEquivalent(translationId: string, id: string) {
    const legacy = await legacyStrongsSearch(translationId, id);
    for (const testament of TESTAMENTS) {
        expect(await strongsSearch(translationId, id, testament), `${translationId} ${id} ${testament}`).toEqual(legacy.filter(inTestament(testament)));
    }
}

const WORDS = [
    'love', 'loved', 'loveth', 'lovest', 'loving', 'lover', 'lovers',
    'stop', 'stopped', 'sin', 'sinned', 'sinner', 'bless', 'blessed', 'blessing', 'fill', 'tell',
    'glory', 'glories', 'gloried', 'carry', 'carried', 'lie', 'lying', 'die', 'dying', 'pray', 'prayer', 'day',
    "lord's", 'Lord’s', 'Lordʼs', 'lord', "children's", "God's",
    'unto', 'shall', 'the', 'and', 'of', 'was', 'his', 'us', 'all',
    'made', 'mad', 'wine', 'win', 'even', 'evening', 'can', 'cane',
    'in the beginning', 'son of man', 'holy spirit', 'jesus', 'moses', 'god', 'LORD', 'selah', 'zzzz', '  ',
];

// Every Strong's id the existing tests use, plus the largest postings and a few that do not exist
const STRONGS = ['H1254', 'H7225', 'h7225', 'H725', 'H8064', 'H776', 'H1961', 'G25', 'G0026', 'G26', 'G5368', 'H157', 'H853', 'G2316', 'G2889', 'G505', 'H3068', 'H6664', 'G3588', 'H430', 'H99999', 'love'];

describe('fixture corpus', () => {
    beforeAll(async () => {
        for (const id of heldIndexes()) releaseIndex(id);
        // Aligned and tagged
        await install('DBY', [
            { osisId: 'John.3.16', text: 'For God so loved the world', lemmas: 'G2316 G25 G2889', align: '[[4,7,"G2316"],[11,16,"G25"],[21,26,"G2889"]]' },
            { osisId: 'John.11.3', text: 'he whom thou lovest is sick', lemmas: 'G5368', align: '[[13,19,"G5368"]]' },
            // "love" here is deliberately unaligned
            { osisId: 'Rom.12.9', text: 'Let love be unfeigned; a lover of good, and lovers of God', lemmas: 'G505', align: '[[9,18,"G505"]]' },
            { osisId: 'Ps.11.7', text: 'the LORD loveth righteousness, and shall bless; blessed be the Lord’s name, he stopped and sinned not', lemmas: 'H3068 H157 H6664', align: '[[4,8,"H3068"],[9,15,"H157 H853"],[16,29,"H6664"]]' },
            { osisId: 'Ps.104.15', text: 'And wine that maketh glad; he made it, not mad, to win glories unto the evening, even unto the day they carried the dying', lemmas: 'H3196 H1254 H1254', align: '[[4,8,"H3196"],[30,34,"H1254"]]' },
            { osisId: 'Gen.1.1', text: 'In the beginning God created the heaven and the earth.', lemmas: 'H7225 H430 H1254 H8064 H776', align: '[[7,16,"H7225"],[17,20,"H430"],[21,28,"H1254"]]' },
            { osisId: 'Sir.1.1', text: 'All wisdom cometh from the Lord, and is with him for ever; he loved it.', lemmas: 'G2962' },
        ]);
        // Tagged, not aligned
        await install('WEB', [
            { osisId: 'Gen.1.1', text: 'In the beginning, God created the heavens and the earth.', lemmas: 'H7225 H430 H1254' },
            { osisId: 'John.3.16', text: 'For God so loved the world, that he gave his one and only Son', lemmas: 'G2316 G25 G2889' },
            { osisId: 'Matt.8.20', text: 'the Son of Man has nowhere to lay his head; the children’s bread' , lemmas: 'G5207 G444' },
        ]);
        // Untagged
        await install('KJV', [
            { osisId: 'John.3.16', text: 'For God so loved the world' },
            { osisId: 'Ps.24.1', text: 'The earth is the Lord’s, and the fulness thereof' },
        ]);
    });

    it('Word Study, flat and lemma-grouped, every testament, every translation', async () => {
        for (const t of ['DBY', 'WEB', 'KJV']) for (const q of WORDS) await expectWordEquivalent(t, q);
    });

    it("Strong's search, every testament, every translation", async () => {
        for (const t of ['DBY', 'WEB', 'KJV']) for (const id of STRONGS) await expectStrongsEquivalent(t, id);
    });
});

const processed = path.resolve(__dirname, '../../../data/processed');
const corpus = process.env.LEGACY_CORPUS === '1' && fs.existsSync(path.join(processed, 'kjv-verses.json'));

describe.runIf(corpus)('real corpus', () => {
    for (const t of ['KJV', 'WEB', 'BSB', 'ASV', 'DBY']) {
        it(`${t}: Word Study and Strong's match the full scans`, async () => {
            await install(t, JSON.parse(fs.readFileSync(path.join(processed, `${t.toLowerCase()}-verses.json`), 'utf-8')));
            // The legacy ASCII \b matched inside ligature names ("a" in Judæa, "us" in Alphæus); see the PR notes
            const words = t === 'ASV' ? WORDS.filter((w) => !['us', 'all'].includes(w)) : WORDS;
            for (const q of words) await expectWordEquivalent(t, q);
            for (const id of STRONGS) await expectStrongsEquivalent(t, id);
            await db.verses.where('translationId').equals(t).delete();
        }, 900_000);
    }
});
