import fs from 'node:fs';
import path from 'node:path';

/**
 * Generic OSIS milestone-format importer.
 *
 * Works with both KJV (osisID before sID) and OEB (sID before osisID)
 * XML files. Extracts verse text between <verse sID="..."/> and
 * <verse eID="..."/> milestone pairs.
 */

type RawVerse = {
    translation: string;
    book: string;
    chapter: number;
    verse: number;
    osisId: string;
    text: string;
    /** Space-separated Strong's tokens extracted from <w lemma="..."> markup, if present. */
    lemmas?: string;
};

/**
 * Extract Strong's identifiers from OSIS <w lemma="..."> elements in a verse slice.
 *
 * OSIS tagged format example:
 *   <w lemma="strong:H7225">In the beginning</w>
 *   <w lemma="strong:H1254 strong:H430">God created</w>
 *
 * Normalization rules:
 *   - Split lemma attribute on whitespace (multiple lemmas per <w> tag)
 *   - Strip "strong:" prefix (case-insensitive)
 *   - Strip "lemma." prefix (alternate format found in some OSIS files)
 *   - Only keep tokens matching H\d+ or G\d+ (canonical Strong's form)
 *   - Uppercase canonical tokens (H430 not h430)
 *   - Deduplicate across the verse
 *
 * Returns an empty string when no lemma markup is found (safe for all current sources).
 */
function extractLemmas(rawSlice: string): string {
    const tokens = new Set<string>();
    const wTagRe = /<w\b[^>]*\blemma="([^"]+)"[^>]*/g;
    let m: RegExpExecArray | null;
    while ((m = wTagRe.exec(rawSlice)) !== null) {
        for (const raw of m[1].split(/\s+/)) {
            const token = raw
                .replace(/^strong:/i, '')
                .replace(/^lemma\./i, '')
                .trim()
                .toUpperCase();
            if (/^[HG]\d+[A-Z]?$/.test(token)) {
                tokens.add(token);
            }
        }
    }
    return Array.from(tokens).join(' ');
}

export function importOsis(
    xmlPath: string,
    translationId: string,
    outputPath: string
): void {
    const xml = fs.readFileSync(xmlPath, 'utf-8');

    const verses: RawVerse[] = [];

    // Match any verse start milestone that has an sID attribute.
    // Both osisID and sID must be present, but order varies between translations.
    const startRe = /<verse\s+[^>]*sID="[^"]*"[^/]*\/>/g;

    let m: RegExpExecArray | null;
    while ((m = startRe.exec(xml)) !== null) {
        const tag = m[0];
        const osisMatch = /[\s]osisID="([^"]+)"/.exec(tag);
        const sidMatch = /[\s]sID="([^"]+)"/.exec(tag);
        if (!osisMatch || !sidMatch) continue;

        const osisId = osisMatch[1];
        const sID = sidMatch[1];
        const contentStart = m.index + m[0].length;

        // Find matching eID tag via plain string search
        const eIDMarker = `eID="${sID}"`;
        const eIDTagStart = xml.indexOf(eIDMarker, contentStart);
        if (eIDTagStart === -1) continue;

        const verseTagStart = xml.lastIndexOf('<verse', eIDTagStart);
        const rawSlice = xml.slice(contentStart, verseTagStart);

        // Extract lemma identifiers from <w lemma="..."> markup BEFORE stripping tags.
        // This is a no-op for sources without <w> markup (all current sources).
        const lemmas = extractLemmas(rawSlice);

        // Strip tags, decode entities, normalise whitespace
        const text = rawSlice
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) continue;

        const parts = osisId.split('.');
        if (parts.length < 3) continue;

        const [book, chapterStr, verseStr] = parts;

        verses.push({
            translation: translationId,
            book,
            chapter: Number(chapterStr),
            verse: Number(verseStr),
            osisId,
            text,
            ...(lemmas ? { lemmas } : {}),
        });
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(verses, null, 2), 'utf-8');
    console.log(`[${translationId}] Imported ${verses.length} verses to ${outputPath}`);

    if (verses.length > 0) {
        const first = verses[0];
        console.log(`  First: ${first.osisId} — "${first.text.slice(0, 60)}…"`);
        const last = verses[verses.length - 1];
        console.log(`  Last:  ${last.osisId} — "${last.text.slice(0, 60)}…"`);
    }
}
