/**
 * What a double-clicked word in the reader opens: someone, somewhere or
 * something in the chapter's enrichment first, then an Easton's entry,
 * then nothing.
 */
import type { Person, Place, BibleEvent, DictionaryEntry } from '@codex-scriptura/core';

export type ChapterEnrichment = { persons: Person[]; places: Place[]; events: BibleEvent[] };

export type WordLookupResult =
    | { kind: 'person'; entity: Person }
    | { kind: 'place'; entity: Place }
    | { kind: 'event'; entity: BibleEvent }
    /** `key` is the word reduced to lowercase letters, for the rail tab id. */
    | { kind: 'dictionary'; key: string; entry: DictionaryEntry }
    | { kind: 'none'; key: string };

/** Lowercase letters only, with at most one common suffix cut when at least three letters stay. */
export function normalizeWord(word: string): string {
    let w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return w;
    const suffixes = ['tion', 'ness', 'ment', 'able', 'ible', 'ing', 'ed', 'er', 'es', 's'];
    for (const suffix of suffixes) {
        if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
            return w.slice(0, -suffix.length);
        }
    }
    return w;
}

export async function resolveWord(
    word: string,
    enrichment: ChapterEnrichment | null,
    lookupDictionary: (term: string) => Promise<DictionaryEntry | undefined>,
): Promise<WordLookupResult> {
    const normalized = normalizeWord(word);
    const original = word.toLowerCase().replace(/[^a-z]/g, '');

    if (enrichment) {
        const person = enrichment.persons.find(p => {
            const n = p.name.toLowerCase();
            return n === original || n === normalized || n.startsWith(normalized);
        });
        if (person) return { kind: 'person', entity: person };

        const place = enrichment.places.find(p => {
            const n = p.name.toLowerCase();
            return n === original || n === normalized || n.startsWith(normalized);
        });
        if (place) return { kind: 'place', entity: place };

        const event = enrichment.events.find(e => {
            const n = e.name.toLowerCase();
            return n === original || n.includes(original);
        });
        if (event) return { kind: 'event', entity: event };
    }

    const entry = (await lookupDictionary(original)) ?? (await lookupDictionary(normalized));
    if (entry) return { kind: 'dictionary', key: original, entry };
    return { kind: 'none', key: original };
}
