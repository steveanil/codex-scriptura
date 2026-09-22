/**
 * Word Study mode: every occurrence of an English word. Decides which
 * spellings count as the word, finds the verses that can hold one in the
 * shared index's `stems` field, and hands only those to the db checks
 * (issue #166). The regex stays the judge of what is an occurrence; the
 * index only spares reading the rest of the translation.
 */

import type { Query } from 'minisearch';
import { findBook } from '@codex-scriptura/core';
import type { ConcordanceSearchResult, LemmaSearchResult } from '@codex-scriptura/core';
import { wordSearch, lemmaGroupSearch } from '@codex-scriptura/db';
import { buildWordPattern, candidateStems, STEMS_SEARCH_OPTIONS } from './config';
import { bookOfVerseId, type Testament } from './fulltext';
import { getOrBuildIndex } from './index-manager';

/** Ids of the verses that can match, in primary-key order (the order the old full scan read them in). */
async function candidateVerseIds(translationId: string, word: string, includeVariants: boolean, testament: Testament): Promise<string[]> {
    const groups = candidateStems(word, includeVariants);
    if (groups.length === 0) return [];
    const index = await getOrBuildIndex(translationId);
    const query: Query = { combineWith: 'OR', queries: groups.map((stems): Query => ({ combineWith: 'AND', queries: stems })) };
    let ids = index.search(query, STEMS_SEARCH_OPTIONS).map((hit) => hit.id as string);
    if (testament !== 'all') ids = ids.filter((id) => findBook(bookOfVerseId(id))?.testament === testament);
    return ids.sort();
}

/** Every verse of a translation where the word (or, with variants, its inflections) occurs. */
export async function searchWord(
    translationId: string,
    word: string,
    includeVariants = false,
    testament: Testament = 'all',
): Promise<ConcordanceSearchResult[]> {
    const pattern = buildWordPattern(word, includeVariants);
    if (!pattern) return [];
    return wordSearch(await candidateVerseIds(translationId, word, includeVariants, testament), pattern);
}

/** The same occurrences grouped by the Strong's lemma behind each one (tagged translations). */
export async function searchWordByLemma(
    translationId: string,
    word: string,
    includeVariants = false,
    testament: Testament = 'all',
): Promise<LemmaSearchResult> {
    const pattern = buildWordPattern(word, includeVariants);
    if (!pattern) return { groups: [], totalHits: 0, totalVerses: 0 };
    return lemmaGroupSearch(await candidateVerseIds(translationId, word, includeVariants, testament), pattern);
}
