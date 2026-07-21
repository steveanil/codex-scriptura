/**
 * Golden-sample verse tests - exact-text assertions for anchor verses in
 * each imported translation. These permanently guard against the class of
 * regression fixed in July 2026 (footnote content leaking into verse text,
 * entity-decoding and whitespace drift).
 *
 * They read the pipeline's processed output (data/processed/*-verses.json),
 * which is gitignored - so they run wherever the pipeline has run
 * (`pnpm run import:all`) and skip cleanly elsewhere (e.g. CI without data).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './core/paths.js';

const processedDir = path.join(dataDir, 'processed');

type Golden = {
    osisId: string;
    text: string;
    lemmas?: string[];
    /** Word-alignment anchors: a span carrying `strongs` must slice to text containing `surface`. */
    align?: Array<{ strongs: string; surface: string }>;
};

const GOLDEN: Record<string, Golden[]> = {
    // KJV is imported from CrossWire's Strong's-tagged OSIS (issue #25).
    // The lemma anchors guard the tag extraction and zero-padding
    // normalization (H07225 → H7225); Gen 2:4 guards the <divineName>
    // small-caps materialisation ("LORD", not "Lord").
    'kjv-verses.json': [
        {
            osisId: 'Gen.1.1',
            text: 'In the beginning God created the heaven and the earth.',
            lemmas: ['H7225', 'H1254', 'H430'],
            // Word alignment (issue #27): the span carrying each lemma must
            // cover its English rendering, guarding offset drift end to end.
            align: [
                { strongs: 'H7225', surface: 'beginning' },
                { strongs: 'H430', surface: 'God' },
                { strongs: 'H1254', surface: 'created' },
            ],
        },
        {
            osisId: 'Gen.2.4',
            text: 'These are the generations of the heavens and of the earth when they were created, in the day that the LORD God made the earth and the heavens,',
            lemmas: ['H3068'],
            align: [{ strongs: 'H3068', surface: 'LORD' }],
        },
        {
            osisId: 'John.3.16',
            text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
            lemmas: ['G25', 'G2889', 'G3439'],
            align: [
                { strongs: 'G25', surface: 'loved' },
                { strongs: 'G2889', surface: 'world' },
            ],
        },
        { osisId: 'Rev.22.21', text: 'The grace of our Lord Jesus Christ be with you all. Amen.' },
    ],
    'web-verses.json': [
        // Gen 1:1 previously read "…God The Hebrew word rendered "God" is
        // "אֱלֹהִ֑ים" (Elohim). created…" due to footnote leakage.
        { osisId: 'Gen.1.1', text: 'In the beginning, God created the heavens and the earth.' },
        { osisId: 'John.3.16', text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.' },
        { osisId: 'Rev.22.21', text: 'The grace of the Lord Jesus Christ be with all the saints. Amen.' },
    ],
    'oeb-verses.json': [
        { osisId: 'Ruth.1.1', text: 'In the time when the judges ruled, there was once a famine in the land. A man from Bethlehem in Judah took his wife and two sons to live in the territory of Moab.' },
        { osisId: 'John.3.16', text: 'For God so loved the world, that he gave his only Son, so that everyone who believes in him may not be lost, but have eternal life.' },
        { osisId: 'Rev.22.21', text: 'May the blessing of the Lord Jesus Christ, be with his people.' },
    ],
    // The 2026-07 eBible expansion. ASV/BSB/DBY carry <w s="Hnnnn"> word
    // markup: these anchors also guard the <w>-stripping rules (a
    // regression would reintroduce spaces before punctuation).
    'asv-verses.json': [
        { osisId: 'Gen.1.1', text: 'In the beginning God created the heavens and the earth.' },
        { osisId: 'John.3.16', text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth on him should not perish, but have eternal life.' },
        { osisId: 'Rev.22.21', text: 'The grace of the Lord Jesus be with the saints. Amen.' },
    ],
    'bsb-verses.json': [
        { osisId: 'Gen.1.1', text: 'In the beginning God created the heavens and the earth.' },
        { osisId: 'John.3.16', text: 'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.' },
        { osisId: 'Rev.22.21', text: 'The grace of the Lord Jesus be with all the saints. Amen.' },
    ],
    'ylt-verses.json': [
        { osisId: 'Gen.1.1', text: "In the beginning of God's preparing the heavens and the earth —" },
        { osisId: 'John.3.16', text: 'for God did so love the world, that His Son — the only begotten — He gave, that every one who is believing in him may not perish, but may have life age-during.' },
        { osisId: 'Rev.22.21', text: 'The grace of our Lord Jesus Christ [is] with you all. Amen.' },
    ],
    'dby-verses.json': [
        { osisId: 'Gen.1.1', text: 'In the beginning God created the heavens and the earth.' },
        { osisId: 'John.3.16', text: 'For God so loved the world, that he gave his only-begotten Son, that whosoever believes on him may not perish, but have life eternal.' },
        { osisId: 'Rev.22.21', text: 'The grace of the Lord Jesus Christ [be] with all the saints.' },
    ],
};

for (const [file, samples] of Object.entries(GOLDEN)) {
    const filePath = path.join(processedDir, file);
    const available = fs.existsSync(filePath);

    describe.runIf(available)(`golden samples - ${file}`, () => {
        // Guarded: a skipped describe body still executes during collection.
        const allVerses: { osisId: string; text: string; lemmas?: string; align?: string }[] = available
            ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
            : [];
        const byId = new Map(allVerses.map((v) => [v.osisId, v]));

        for (const { osisId, text, lemmas, align } of samples) {
            it(`${osisId} matches exactly`, () => {
                expect(byId.get(osisId)?.text).toBe(text);
            });

            if (lemmas) {
                it(`${osisId} carries Strong's lemmas`, () => {
                    const tokens = new Set((byId.get(osisId)?.lemmas ?? '').split(' '));
                    for (const token of lemmas) {
                        expect(tokens).toContain(token);
                    }
                });
            }

            if (align) {
                it(`${osisId} aligns lemmas to their English renderings`, () => {
                    const verse = byId.get(osisId)!;
                    const spans = JSON.parse(verse.align ?? '[]') as [number, number, string][];
                    for (const { strongs, surface } of align) {
                        const hit = spans.find(([, , ids]) => ids.split(' ').includes(strongs));
                        expect(hit, `no span carries ${strongs}`).toBeDefined();
                        expect(verse.text.slice(hit![0], hit![1])).toContain(surface);
                    }
                });
            }
        }

        // Structural integrity of every alignment span in the file: within
        // bounds, non-empty, no edge whitespace, IDs a subset of the verse's
        // lemma bag. Plain checks collecting violations (an expect() per span
        // would be ~700k calls and blow the test timeout).
        it.runIf(allVerses.some((v) => v.align))('every alignment span is well-formed', () => {
            const violations: string[] = [];
            let checked = 0;
            for (const v of allVerses) {
                if (!v.align) continue;
                const spans = JSON.parse(v.align) as [number, number, string][];
                const lemmaBag = new Set((v.lemmas ?? '').split(' '));
                for (const [start, end, ids] of spans) {
                    if (!(start >= 0 && end > start && end <= v.text.length)) {
                        violations.push(`${v.osisId}: bad range ${start}-${end}`);
                        continue;
                    }
                    const slice = v.text.slice(start, end);
                    if (slice.trim() !== slice) violations.push(`${v.osisId}: edge whitespace in "${slice}"`);
                    for (const id of ids.split(' ')) {
                        if (!lemmaBag.has(id)) violations.push(`${v.osisId}: ${id} not in lemma bag`);
                    }
                    checked++;
                }
            }
            expect(violations.slice(0, 20)).toEqual([]);
            expect(checked).toBeGreaterThan(0);
        });

        it('contains no leaked footnote markers', () => {
            // Footnote bodies in our sources carry telltale phrases that
            // must never appear inside verse text.
            const telltales = ['The Hebrew word rendered', 'omitted by the best authorities', 'Some manuscripts add'];
            let hits = 0;
            for (const { text } of byId.values()) {
                if (telltales.some((t) => text.includes(t))) hits++;
            }
            expect(hits).toBe(0);
        });
    });
}
