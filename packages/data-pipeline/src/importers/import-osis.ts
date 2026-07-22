import fs from 'node:fs';
import path from 'node:path';
import { recordImportRun } from '../core/import-runs.js';
import { removeElements } from '../core/xml.js';

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
    /** JSON-encoded [start, end, "H7225"] word-alignment spans into `text`, if present. */
    align?: string;
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
 *   - Strip leading zeros from the number (CrossWire writes H07225; the
 *     lexicon and search index key on the unpadded H7225 form)
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
                .toUpperCase()
                .replace(/^([HG])0+(?=\d)/, '$1');
            if (/^[HG]\d+[A-Z]?$/.test(token)) {
                tokens.add(token);
            }
        }
    }
    return Array.from(tokens).join(' ');
}

/** [start, end, space-separated Strong's IDs] - char range of the final verse text. */
type AlignSpan = [number, number, string];

/**
 * Normalize one lemma-attribute token to canonical Strong's form (H7225/G26),
 * or return null when it isn't one. Same rules as extractLemmas above.
 */
function normalizeStrongsToken(raw: string): string | null {
    const token = raw
        .replace(/^strong:/i, '')
        .replace(/^lemma\./i, '')
        .trim()
        .toUpperCase()
        .replace(/^([HG])0+(?=\d)/, '$1');
    return /^[HG]\d+[A-Z]?$/.test(token) ? token : null;
}

const WRAPPER_TAG_RE = /^\/?(?:transChange|seg|hi|q|foreign|inscription|name|abbr)\b/;

const ENTITIES: Array<[string, string]> = [
    ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&apos;', "'"], ['&quot;', '"'],
];

/**
 * Single-pass walk of a raw OSIS verse slice producing the final plain text
 * AND word-alignment spans: which [start, end) ranges of that text came from
 * which <w lemma="strong:…"> element.
 *
 * The walk mirrors the regex text chain in importOsis exactly (w/wrapper tags
 * stripped with no replacement, <divineName> inner text uppercased in place,
 * other tags become spaces, entities decoded, whitespace collapsed, trimmed).
 * The caller verifies the walk's text against the regex chain's and drops
 * alignment for any verse where they drift, so a walk bug can never corrupt
 * verse text or misattach a Strong's number - it only loses alignment.
 */
function extractTextAndAlignment(rawSlice: string): { text: string; align: AlignSpan[] } {
    // Pre-collapse text with, per character, the Strong's tokens of the
    // innermost enclosing <w> ('' when outside any tagged word).
    let out = '';
    const lem: string[] = [];
    const wStack: string[] = [];
    let divineDepth = 0;

    const push = (ch: string) => {
        out += divineDepth > 0 ? ch.toUpperCase() : ch;
        lem.push(wStack.length > 0 ? wStack[wStack.length - 1] : '');
    };

    let i = 0;
    while (i < rawSlice.length) {
        if (rawSlice[i] === '<') {
            const end = rawSlice.indexOf('>', i);
            if (end === -1) { push(rawSlice[i]); i++; continue; }
            const tag = rawSlice.slice(i + 1, end);
            const selfClosing = tag.endsWith('/');
            if (/^w\b/.test(tag)) {
                if (!selfClosing) {
                    const attr = /\blemma="([^"]*)"/.exec(tag);
                    const tokens = (attr?.[1] ?? '').split(/\s+/)
                        .map(normalizeStrongsToken)
                        .filter((t): t is string => t !== null);
                    wStack.push(tokens.join(' '));
                }
            } else if (/^\/w\s*$/.test(tag)) {
                wStack.pop();
            } else if (/^divineName\b/.test(tag)) {
                if (!selfClosing) divineDepth++;
            } else if (/^\/divineName\s*$/.test(tag)) {
                divineDepth = Math.max(0, divineDepth - 1);
            } else if (WRAPPER_TAG_RE.test(tag)) {
                // stripped with no replacement, punctuation stays attached
            } else {
                out += ' ';
                lem.push(wStack.length > 0 ? wStack[wStack.length - 1] : '');
            }
            i = end + 1;
        } else {
            let matched = false;
            for (const [entity, replacement] of ENTITIES) {
                if (rawSlice.startsWith(entity, i)) {
                    push(replacement);
                    i += entity.length;
                    matched = true;
                    break;
                }
            }
            if (!matched) { push(rawSlice[i]); i++; }
        }
    }

    // Collapse whitespace and trim, carrying the parallel lemma flags.
    let text = '';
    const flags: string[] = [];
    let prevSpace = true;
    for (let k = 0; k < out.length; k++) {
        if (/\s/.test(out[k])) {
            if (!prevSpace) { text += ' '; flags.push(lem[k]); prevSpace = true; }
        } else {
            text += out[k];
            flags.push(lem[k]);
            prevSpace = false;
        }
    }
    if (text.endsWith(' ')) { text = text.slice(0, -1); flags.pop(); }

    // Contiguous runs of the same lemma value become spans; trailing/leading
    // spaces inside a run are shaved off so surfaces slice cleanly.
    const align: AlignSpan[] = [];
    let runStart = -1;
    let runLem = '';
    const pushRun = (endExclusive: number) => {
        let s = runStart, e = endExclusive;
        while (s < e && text[s] === ' ') s++;
        while (e > s && text[e - 1] === ' ') e--;
        if (e > s) align.push([s, e, runLem]);
    };
    for (let k = 0; k <= flags.length; k++) {
        const f = k < flags.length ? flags[k] : '';
        if (f !== runLem) {
            if (runLem) pushRun(k);
            runStart = k;
            runLem = f;
        }
    }

    return { text, align };
}

export function importOsis(
    xmlPath: string,
    translationId: string,
    outputPath: string
): void {
    const xml = fs.readFileSync(xmlPath, 'utf-8');

    const verses: RawVerse[] = [];
    let alignMismatches = 0;

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
        // Remove <note> elements (with their content) FIRST - the generic tag
        // stripping below keeps inner text, which would leak translator
        // footnotes into scripture text (48 such notes in the OEB source).
        const rawSlice = removeElements(xml.slice(contentStart, verseTagStart), ['note']);

        // Extract lemma identifiers from <w lemma="..."> markup BEFORE stripping tags.
        // This is a no-op for sources without <w> markup (all current sources).
        const lemmas = extractLemmas(rawSlice);

        // Strip tags, decode entities, normalise whitespace.
        // Inline wrappers (<w>, <transChange>, <seg>, <q>, <hi>, ...) sit
        // flush against punctuation in CrossWire's KJV (<w>earth</w>. and
        // <transChange>generation</transChange>:), so they are removed with
        // NO replacement - a space would detach the punctuation ("earth .").
        // Words are separated by literal whitespace in the source. Remaining
        // structural tags (titles, milestones) become spaces.
        // <divineName>Lord</divineName> is rendered in small caps in print;
        // materialise it as LORD/GOD to keep the KJV's Jehovah/Adonai
        // distinction in plain text.
        const text = rawSlice
            .replace(/<\/?w\b[^>]*>/g, '')
            .replace(/<divineName\b[^>]*>([^<]*)<\/divineName>/g, (_, inner: string) => inner.toUpperCase())
            .replace(/<\/?(?:transChange|seg|hi|q|foreign|inscription|name|abbr)\b[^>]*>/g, '')
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

        // Word-alignment spans from the mirror walk, verified against the
        // regex chain's text. On drift the alignment is dropped (verse-level
        // lemmas above are unaffected).
        let align: string | undefined;
        if (lemmas) {
            const walked = extractTextAndAlignment(rawSlice);
            if (walked.text === text) {
                if (walked.align.length > 0) align = JSON.stringify(walked.align);
            } else {
                alignMismatches++;
            }
        }

        verses.push({
            translation: translationId,
            book,
            chapter: Number(chapterStr),
            verse: Number(verseStr),
            osisId,
            text,
            ...(lemmas ? { lemmas } : {}),
            ...(align ? { align } : {}),
        });
    }

    if (alignMismatches > 0) {
        console.warn(`[${translationId}] Alignment walk diverged from text chain in ${alignMismatches} verses - alignment dropped there (lemmas kept).`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(verses), 'utf-8');
    recordImportRun(path.join(path.dirname(outputPath), '_metadata'), {
        sourceIds: [`${translationId.toLowerCase()}-text`],
        inputFiles: [xmlPath],
        stats: { created: verses.length, updated: 0, skipped: 0, conflicts: 0 },
    });
    console.log(`[${translationId}] Imported ${verses.length} verses to ${outputPath}`);

    if (verses.length > 0) {
        const first = verses[0];
        console.log(`  First: ${first.osisId} - "${first.text.slice(0, 60)}…"`);
        const last = verses[verses.length - 1];
        console.log(`  Last:  ${last.osisId} - "${last.text.slice(0, 60)}…"`);
    }
}
