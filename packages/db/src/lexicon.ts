import type { LexiconEntry } from '@codex-scriptura/core';
import { db } from './database.js';

/** Look up a Strong's entry by its ID (e.g. "H430"). */
export async function getLexiconEntry(id: string): Promise<LexiconEntry | undefined> {
    return db.lexicon.get(id);
}

/** Lowercase and strip combining diacritics: "agápē" → "agape". */
function foldDiacritics(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Search the lexicon by gloss (English definition) or lemma (original language word).
 * Case-insensitive substring match against both fields; transliterations are
 * diacritic-folded so a plain-ASCII query like "agape" matches "agápē".
 * Returns all matching entries across Hebrew and Greek.
 *
 * This is a full table scan (~8K+ rows) - suitable for interactive search with
 * debouncing but not for high-frequency programmatic use.
 */
export async function searchLexicon(query: string): Promise<LexiconEntry[]> {
    const q = foldDiacritics(query.trim());
    if (!q) return [];

    return db.lexicon
        .filter(entry =>
            entry.gloss.toLowerCase().includes(q) ||
            entry.lemma.toLowerCase().includes(q) ||
            foldDiacritics(entry.transliteration).includes(q) ||
            entry.strongsNumber.toLowerCase() === q
        )
        .toArray();
}
