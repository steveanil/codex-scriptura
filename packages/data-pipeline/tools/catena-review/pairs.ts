/**
 * Every excerpt pair the oracle comparison makes, with its classification
 * and canonical words, and the classifier's accepted word pairs, for page
 * review (review.py, show.py) and for auditing what the classifier accepts.
 *
 *   pnpm exec tsx tools/catena-review/pairs.ts     (after import:catena)
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../src/core/paths.js';
import { verify, canonicalWords, similarity, type ComparedPair, type ReviewIndex } from '../../src/verify-catena-oracle.js';
import { WORD_VARIANTS } from '../../src/verify-catena-variants.js';
import type { RawCommentaryEntry } from '@codex-scriptura/core';

const corpus = path.join(dataDir, 'processed', 'commentary-catena-aurea.json');
const entries = JSON.parse(fs.readFileSync(corpus, 'utf-8')) as RawCommentaryEntry[];
const review = JSON.parse(fs.readFileSync(corpus.replace(/\.json$/, '.review-index.json'), 'utf-8')) as ReviewIndex;
const pairs: Array<ComparedPair & { a: string[]; b: string[]; sim: number; csim: number }> = [];
verify(entries, path.join(dataDir, 'texts', 'catena', 'oracle'), review, (p) => {
    const a = canonicalWords(p.ours, 'ours'), b = canonicalWords(p.oracle, 'oracle');
    pairs.push({ ...p, a, b, sim: similarity(p.ours, p.oracle), csim: similarity(a.join(' '), b.join(' ')) });
});
const out = path.join(dataDir, 'scratch', 'catena-review', 'pairs.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ variants: [...WORD_VARIANTS], pairs }));
const count = (k: string) => pairs.filter((p) => p.kind === k).length;
console.log(`${out}: ${pairs.length} pairs, exact ${count('exact')}, benign ${count('benign-ocr')}, lexical ${count('lexical')}`);
