/**
 * Word Study mode: every occurrence of an English word. Decides which
 * spellings count as the word, then hands the pattern to the db scans.
 */

import type { ConcordanceSearchResult, LemmaSearchResult } from '@codex-scriptura/core';
import { wordSearch, lemmaGroupSearch } from '@codex-scriptura/db';
import { buildWordPattern } from './config';
import type { Testament } from './fulltext';

/** Every verse of a translation where the word (or, with variants, its inflections) occurs. */
export async function searchWord(
    translationId: string,
    word: string,
    includeVariants = false,
): Promise<ConcordanceSearchResult[]> {
    const pattern = buildWordPattern(word, includeVariants);
    return pattern ? wordSearch(translationId, pattern) : [];
}

/** The same occurrences grouped by the Strong's lemma behind each one (tagged translations). */
export async function searchWordByLemma(
    translationId: string,
    word: string,
    includeVariants = false,
    testament: Testament = 'all',
): Promise<LemmaSearchResult> {
    const pattern = buildWordPattern(word, includeVariants);
    return pattern ? lemmaGroupSearch(translationId, pattern, testament) : { groups: [], totalHits: 0, totalVerses: 0 };
}
