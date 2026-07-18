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

type Golden = { osisId: string; text: string };

const GOLDEN: Record<string, Golden[]> = {
    'kjv-verses.json': [
        { osisId: 'Gen.1.1', text: 'In the beginning God created the heaven and the earth.' },
        { osisId: 'John.3.16', text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
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
};

for (const [file, samples] of Object.entries(GOLDEN)) {
    const filePath = path.join(processedDir, file);
    const available = fs.existsSync(filePath);

    describe.runIf(available)(`golden samples - ${file}`, () => {
        // Guarded: a skipped describe body still executes during collection.
        const byId = new Map<string, string>(
            available
                ? (JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { osisId: string; text: string }[])
                    .map((v) => [v.osisId, v.text])
                : [],
        );

        for (const { osisId, text } of samples) {
            it(`${osisId} matches exactly`, () => {
                expect(byId.get(osisId)).toBe(text);
            });
        }

        it('contains no leaked footnote markers', () => {
            // Footnote bodies in our sources carry telltale phrases that
            // must never appear inside verse text.
            const telltales = ['The Hebrew word rendered', 'omitted by the best authorities', 'Some manuscripts add'];
            let hits = 0;
            for (const text of byId.values()) {
                if (telltales.some((t) => text.includes(t))) hits++;
            }
            expect(hits).toBe(0);
        });
    });
}
