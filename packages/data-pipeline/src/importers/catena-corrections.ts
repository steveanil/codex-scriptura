/**
 * Manual corrections to the Catena Aurea OCR (issue #85).
 *
 * The oracle comparison points at a disagreement; a person opens the scanned
 * page the locator names, reads it, and records what the page says. Each
 * correction therefore names the leaf it was read from and replaces one
 * exact string in one excerpt (or the lemma) of one block, so a correction
 * that no longer matches, because the OCR or the parser changed, fails
 * loudly instead of silently doing nothing.
 *
 * The file lives in the repository (corrections/catena-aurea.json), unlike
 * the OCR it corrects, because it is our work and the pipeline must
 * reproduce the dataset from the scan plus this file alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CatenaBlock } from './catena-aurea.js';

export type Correction = {
    /** Scan item the block was read from. */
    item: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    /** 1-based excerpt within the block, or 0 for the lemma. */
    excerpt: number;
    /** Exact text as the OCR produced it; must occur exactly once in the target. */
    find: string;
    /** What the page says. */
    replace: string;
    /** The leaf the correction was read from; it must lie within the block's locator. */
    leaf: number;
    /** What was wrong, in a few words. */
    note?: string;
};

export const CORRECTIONS_FILE = path.resolve(import.meta.dirname, '..', '..', 'corrections', 'catena-aurea.json');

export function loadCorrections(file: string = CORRECTIONS_FILE): Correction[] {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Correction[];
}

/** Apply every correction for `item`; a correction whose target or text is not found throws, because a silent no-op would hide drift. */
export function applyCorrections(blocks: CatenaBlock[], corrections: Correction[], item: string): CatenaBlock[] {
    for (const c of corrections) {
        if (c.item !== item) continue;
        const where = `${c.item} ${c.chapter}:${c.verseStart}-${c.verseEnd} excerpt ${c.excerpt}`;
        const block = blocks.find((b) => b.chapter === c.chapter && b.verseStart === c.verseStart && b.verseEnd === c.verseEnd);
        if (!block) throw new Error(`[catena] correction targets a block that was not parsed: ${where}`);
        if (block.source.leafStart > c.leaf || block.source.leafEnd < c.leaf) throw new Error(`[catena] correction read from leaf ${c.leaf}, but the block spans leaves ${block.source.leafStart}-${block.source.leafEnd}: ${where}`);
        const apply = (text: string): string => {
            const first = text.indexOf(c.find);
            if (first < 0) throw new Error(`[catena] correction text not found: ${where}: "${c.find}"`);
            if (text.indexOf(c.find, first + 1) >= 0) throw new Error(`[catena] correction text is ambiguous (occurs more than once): ${where}: "${c.find}"`);
            return text.slice(0, first) + c.replace + text.slice(first + c.find.length);
        };
        if (c.excerpt === 0) block.lemma = apply(block.lemma);
        else {
            const e = block.excerpts[c.excerpt - 1];
            if (!e) throw new Error(`[catena] correction targets excerpt ${c.excerpt} of a block with ${block.excerpts.length}: ${where}`);
            e.text = apply(e.text);
        }
    }
    return blocks;
}
