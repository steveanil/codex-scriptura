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
import { allExcerpts, type CatenaBlock, type LineCorrection } from './catena-aurea.js';

export type { LineCorrection };

export type Correction = {
    /** Scan item the block was read from. */
    item: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    /** 1-based occurrence of this exact verse range within the scan: the edition prints some verses as several lemma blocks. */
    occurrence: number;
    /** 1-based excerpt within the block, or 0 for the lemma. */
    excerpt: number;
    /** Exact text as the OCR produced it; must occur exactly once in the target. Omitted when only the range is corrected. */
    find?: string;
    /** What the page says. */
    replace?: string;
    /** The verse range the page prints for this block, when the OCR misread a verse number (excerpt must be 0). */
    setRange?: [number, number];
    /** The margin citation the page prints for the excerpt, where the OCR of the small margin type failed. */
    citation?: string;
    /** The citation as the OCR read it ("" for none): the correction stands only while the reading is unchanged. */
    citationWas?: string;
    /** The leaf the correction was read from; it must lie within the block's locator. */
    leaf: number;
    /** What was wrong, in a few words. */
    note?: string;
};

export const CORRECTIONS_FILE = path.resolve(import.meta.dirname, '..', '..', 'corrections', 'catena-aurea.json');
/** Line corrections applied before parsing (see LineCorrection); the excerpt-keyed file above is for text the parser already placed. */
export const LINE_CORRECTIONS_FILE = path.resolve(import.meta.dirname, '..', '..', 'corrections', 'catena-aurea.ocr.json');

export function loadLineCorrections(file: string = LINE_CORRECTIONS_FILE): LineCorrection[] {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as LineCorrection[];
}

export function loadCorrections(file: string = CORRECTIONS_FILE): Correction[] {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Correction[];
}

/** Apply every correction for `item`; a correction whose target or text is not found throws, because a silent no-op would hide drift. */
export function applyCorrections(blocks: CatenaBlock[], corrections: Correction[], item: string): CatenaBlock[] {
    for (const c of corrections) {
        if (c.item !== item) continue;
        const where = `${c.item} ${c.chapter}:${c.verseStart}-${c.verseEnd} occurrence ${c.occurrence} excerpt ${c.excerpt}`;
        if (!Number.isInteger(c.occurrence) || c.occurrence < 1) throw new Error(`[catena] correction needs a 1-based occurrence: ${where}`);
        const block = blocks.filter((b) => b.chapter === c.chapter && b.verseStart === c.verseStart && b.verseEnd === c.verseEnd)[c.occurrence - 1];
        if (!block) throw new Error(`[catena] correction targets a block that was not parsed: ${where}`);
        if (block.source.leafStart > c.leaf || block.source.leafEnd < c.leaf) throw new Error(`[catena] correction read from leaf ${c.leaf}, but the block spans leaves ${block.source.leafStart}-${block.source.leafEnd}: ${where}`);
        const apply = (text: string): string => {
            const find = c.find!;
            const first = text.indexOf(find);
            if (first < 0) throw new Error(`[catena] correction text not found: ${where}: "${find}"`);
            if (text.indexOf(find, first + 1) >= 0) throw new Error(`[catena] correction text is ambiguous (occurs more than once): ${where}: "${find}"`);
            return text.slice(0, first) + c.replace + text.slice(first + find.length);
        };
        if (c.setRange) {
            if (c.excerpt !== 0) throw new Error(`[catena] a range correction targets the block (excerpt 0): ${where}`);
            if (!Number.isInteger(c.setRange[0]) || !Number.isInteger(c.setRange[1]) || c.setRange[0] < 1 || c.setRange[1] < c.setRange[0]) throw new Error(`[catena] setRange must be an ordered verse range: ${where}`);
            block.verseStart = c.setRange[0];
            block.verseEnd = c.setRange[1];
        }
        if (c.citation !== undefined) {
            if (c.excerpt < 1) throw new Error(`[catena] a citation correction targets an excerpt: ${where}`);
            if (c.citationWas === undefined) throw new Error(`[catena] a citation correction records the citation it replaces (citationWas): ${where}`);
            const e = allExcerpts(block)[c.excerpt - 1];
            if (!e) throw new Error(`[catena] correction targets excerpt ${c.excerpt} of a block with ${allExcerpts(block).length}: ${where}`);
            if ((e.citation ?? '') !== c.citationWas) throw new Error(`[catena] citation correction is stale: ${where}: the OCR now reads "${e.citation ?? ''}", not "${c.citationWas}"`);
            e.citation = c.citation;
        }
        if (c.find === undefined) { if (!c.setRange && c.citation === undefined) throw new Error(`[catena] correction does nothing: ${where}`); continue; }
        if (c.replace === undefined) throw new Error(`[catena] correction has find but no replace: ${where}`);
        if (c.excerpt === 0) block.lemma = apply(block.lemma);
        else {
            const every = allExcerpts(block);
            const e = every[c.excerpt - 1];
            if (!e) throw new Error(`[catena] correction targets excerpt ${c.excerpt} of a block with ${every.length}: ${where}`);
            e.text = apply(e.text);
        }
    }
    return blocks;
}
