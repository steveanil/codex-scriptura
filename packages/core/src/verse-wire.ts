/**
 * The pipeline-to-app wire format for verse JSON, plus the Strong's token
 * normalization both importers share. Previously RawVerse was declared
 * three times (import-usfx, import-osis, seed.ts) and had already
 * diverged, and extractLemmas existed twice with inconsistent
 * zero-stripping - drift here is a data-corruption class bug (issue #170).
 */

/** One verse as written by the pipeline importers and read by the app's seeder. */
export type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    /** Last verse of a bridged entry (e.g. <v id="15-16"/>); `verse` is the first. */
    verseEnd?: number;
    osisId: string;
    text: string;
    /** Space-separated Strong's tokens extracted from lemma markup (tagged sources only). */
    lemmas?: string;
    /** JSON-encoded [start, end, "H7225"] word-alignment spans into `text` (tagged sources only). */
    align?: string;
    /** JSON-encoded array of [start, end] character offset pairs for words of Jesus. */
    wj?: string;
};

/**
 * Normalize one lemma-attribute token to canonical Strong's form (H7225/G26),
 * or return null when it isn't one: strip `strong:`/`lemma.` prefixes,
 * uppercase, drop zero padding (H0430 → H430) so tokens join against the
 * lexicon regardless of source padding.
 */
export function normalizeStrongsToken(raw: string): string | null {
    const token = raw
        .replace(/^strong:/i, '')
        .replace(/^lemma\./i, '')
        .trim()
        .toUpperCase()
        .replace(/^([HG])0+(?=\d)/, '$1');
    return /^[HG]\d+[A-Z]?$/.test(token) ? token : null;
}

/**
 * Extract deduplicated Strong's identifiers from <w> markup in a raw verse
 * slice. `attrNames` selects the attribute forms in the wild: OSIS carries
 * lemma="strong:H7225", eBible USFX carries s="H7225" alongside lemma.
 * Returns a space-separated token string, empty when no lemma markup exists.
 */
export function extractLemmas(rawSlice: string, attrNames: readonly string[] = ['lemma']): string {
    const tokens = new Set<string>();
    const wTagRe = new RegExp(`<w\\b[^>]*?\\b(?:${attrNames.join('|')})="([^"]+)"[^>]*`, 'g');
    let m: RegExpExecArray | null;
    while ((m = wTagRe.exec(rawSlice)) !== null) {
        for (const raw of m[1].split(/\s+/)) {
            const token = normalizeStrongsToken(raw);
            if (token) tokens.add(token);
        }
    }
    return Array.from(tokens).join(' ');
}
