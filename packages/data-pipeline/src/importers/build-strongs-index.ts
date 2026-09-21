import fs from 'node:fs';
import path from 'node:path';
import type { StrongsPosting } from '@codex-scriptura/core';

/**
 * Strong's postings for one tagged translation (issue #166): for every
 * Strong's id, the verses whose `lemmas` carry it. A Strong's search reads
 * its one row and then only those verses, instead of scanning the
 * translation.
 *
 * Acceleration data with no authority of its own: it is built from the
 * processed verses file in the same pipeline run and shipped as a dataset
 * derived from that translation, so its manifest version folds in the
 * translation's content hash and the client never pairs it with another
 * copy of the text.
 */

type TaggedVerse = { osisId: string; lemmas?: string };

function compareStrongs(a: string, b: string): number {
    return a[0] === b[0] ? Number(a.slice(1)) - Number(b.slice(1)) : a < b ? -1 : 1;
}

/** One posting per Strong's id, verses in the order given (canonical in a processed file), ids by letter then number. */
export function strongsPostings(verses: TaggedVerse[]): StrongsPosting[] {
    const postings = new Map<string, string[]>();
    for (const { osisId, lemmas } of verses) {
        if (!lemmas) continue;
        for (const strongsId of new Set(lemmas.split(' ').filter(Boolean))) {
            const osisIds = postings.get(strongsId);
            if (osisIds) osisIds.push(osisId);
            else postings.set(strongsId, [osisId]);
        }
    }
    return [...postings]
        .map(([strongsId, osisIds]) => ({ strongsId, osisIds }))
        .sort((a, b) => compareStrongs(a.strongsId, b.strongsId));
}

/** Read a processed verses file and write its postings beside it. */
export function buildStrongsIndex(versesPath: string, outputPath: string): { postings: number; bytes: number; largest: StrongsPosting | undefined } {
    const verses: TaggedVerse[] = JSON.parse(fs.readFileSync(versesPath, 'utf-8'));
    const postings = strongsPostings(verses);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(postings), 'utf-8');
    const largest = postings.reduce<StrongsPosting | undefined>((max, p) => (!max || p.osisIds.length > max.osisIds.length ? p : max), undefined);
    return { postings: postings.length, bytes: fs.statSync(outputPath).size, largest };
}
