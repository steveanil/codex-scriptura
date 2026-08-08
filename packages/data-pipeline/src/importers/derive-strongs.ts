/**
 * Strong's derivation from original-language texts (issue #134).
 *
 * No open Strong's-tagged WEB edition exists, so instead of reading tags
 * embedded in the translation file (the OSIS/USFX importers' approach),
 * this module derives a per-verse Strong's token set - "the original-language
 * words underlying this verse" - from:
 *
 *   OT: OpenScriptures Hebrew Bible (morphhb) - OSIS <w lemma="..."> markup
 *       over the Westminster Leningrad Codex. Hebrew (WLC) versification
 *       differs from English in ~40 places (Psalm titles, Joel 3/4,
 *       Malachi 3/4, mid-verse splits); morphhb documents every difference
 *       twice, and both catalogs are used here:
 *       - VerseMap.xml lists whole-verse remappings (WLC ref -> KJV ref).
 *       - Inline <note>KJV:Ref</note> markers inside verse bodies pin the
 *         exact word where an English verse begins, giving sub-verse
 *         precision that whole-verse mapping cannot (Psalm superscriptions
 *         embedded in Hebrew verse 1, and verses straddling an English
 *         boundary).
 *   NT: Robinson-Pierpont Byzantine Majority Text - Strong's-parsed source
 *       files ("CC.VV word 1234 {N-NSF} ..."). The Byzantine text is the
 *       WEB's NT textual base, so its versification matches the WEB directly
 *       (e.g. the Romans doxology at 14:24-26).
 *
 * The output is verse-level `lemmas` only - never `align` spans, which
 * require word-level tagging inside the translation itself.
 */

/** OSIS book IDs of the 39 OT books, matching morphhb's wlc/ file names. */
export const MORPHHB_BOOKS = [
    'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth',
    '1Sam', '2Sam', '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth',
    'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan',
    'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph',
    'Hag', 'Zech', 'Mal',
] as const;

/** Byzantine source file names mapped to OSIS book IDs. */
export const BYZANTINE_FILES: ReadonlyArray<{ file: string; book: string }> = [
    { file: '01_MAT.BP5', book: 'Matt' },
    { file: '02_MAR.BP5', book: 'Mark' },
    { file: '03_LUK.BP5', book: 'Luke' },
    { file: '04_JOH.BP5', book: 'John' },
    { file: '05_ACT.BP5', book: 'Acts' },
    { file: '06_ROM.BP5', book: 'Rom' },
    { file: '07_1CO.BP5', book: '1Cor' },
    { file: '08_2CO.BP5', book: '2Cor' },
    { file: '09_GAL.BP5', book: 'Gal' },
    { file: '10_EPH.BP5', book: 'Eph' },
    { file: '11_PHP.BP5', book: 'Phil' },
    { file: '12_COL.BP5', book: 'Col' },
    { file: '13_1TH.BP5', book: '1Thess' },
    { file: '14_2TH.BP5', book: '2Thess' },
    { file: '15_1TI.BP5', book: '1Tim' },
    { file: '16_2TI.BP5', book: '2Tim' },
    { file: '17_TIT.BP5', book: 'Titus' },
    { file: '18_PHM.BP5', book: 'Phlm' },
    { file: '19_HEB.BP5', book: 'Heb' },
    { file: '20_JAM.BP5', book: 'Jas' },
    { file: '21_1PE.BP5', book: '1Pet' },
    { file: '22_2PE.BP5', book: '2Pet' },
    { file: '23_1JO.BP5', book: '1John' },
    { file: '24_2JO.BP5', book: '2John' },
    { file: '25_3JO.BP5', book: '3John' },
    { file: '26_JUD.BP5', book: 'Jude' },
    { file: '27_REV.BP5', book: 'Rev' },
];

/**
 * Convert one morphhb lemma attribute into Strong's tokens.
 *
 * morphhb lemma grammar: slash-separated segments where letter-only
 * segments are untagged prefix particles ("b/7225" - the bet preposition
 * has no plain-Strong's number), " a"/" b" suffixes are Augmented Strong's
 * disambiguation letters, and "+" marks a multi-word proper-noun compound
 * ("884+"). The KJV's CrossWire tagging uses plain unlettered numbers, so
 * augment letters are dropped here to keep tokens comparable across
 * translations; leading zeros are impossible by construction (numeric parse).
 */
export function lemmaToStrongs(lemma: string): string[] {
    const tokens: string[] = [];
    for (const match of lemma.matchAll(/\d+/g)) {
        tokens.push(`H${parseInt(match[0], 10)}`);
    }
    return tokens;
}

/** Strip a sub-verse marker: "Ps.13.6!a" -> "Ps.13.6". */
function stripMarker(ref: string): string {
    return ref.replace(/!\w+$/, '');
}

function dedupe(tokens: string[]): string[] {
    return [...new Set(tokens)];
}

/** One WLC verse, parsed but not yet mapped to English versification. */
export type WlcVerse = {
    osisId: string;
    /**
     * Tokens before the first KJV boundary note - or ALL tokens when the
     * verse has no notes (the common, fully-aligned case).
     */
    preNote: string[];
    /** Tokens after each KJV boundary note, keyed by the marker-stripped note ref. */
    segments: Array<{ kjv: string; tokens: string[] }>;
};

/**
 * Parse one morphhb book file into per-verse token segments.
 *
 * Verses are container-style (<verse osisID="Gen.1.1">...</verse>).
 * Every <w lemma="..."> contributes tokens - including ketiv words
 * (type="x-ketiv") and qere readings inside variant notes: both are
 * genuine underlying words, and per-verse deduplication makes the usual
 * same-lemma pairs harmless. <note>KJV:Ref</note> boundary markers split
 * the verse into segments so mapWlcToEnglish can assign each part to the
 * English verse it actually belongs to.
 */
export function parseMorphhbBook(xml: string): WlcVerse[] {
    const verses: WlcVerse[] = [];
    const tokensOf = (fragment: string): string[] => {
        const tokens: string[] = [];
        for (const w of fragment.matchAll(/<w [^>]*lemma="([^"]*)"/g)) {
            tokens.push(...lemmaToStrongs(w[1]));
        }
        return dedupe(tokens);
    };

    for (const verseMatch of xml.matchAll(/<verse osisID="([^"]+)">([\s\S]*?)<\/verse>/g)) {
        const osisId = verseMatch[1];
        // Split into [pre, noteRef1, segment1, noteRef2, segment2, ...]
        const parts = verseMatch[2].split(/<note>KJV:([^<]+)<\/note>/);
        const segments: WlcVerse['segments'] = [];
        for (let i = 1; i < parts.length; i += 2) {
            segments.push({ kjv: stripMarker(parts[i]), tokens: tokensOf(parts[i + 1]) });
        }
        verses.push({ osisId, preNote: tokensOf(parts[0]), segments });
    }
    return verses;
}

export type VerseMapData = {
    /** Marker-stripped WLC ref -> ordered unique KJV target refs. */
    wholeVerse: Map<string, string[]>;
    /**
     * WLC refs whose FIRST part belongs to the previous English verse
     * (VerseMap entries with a "!a" marker on the WLC side, e.g.
     * "1Kgs.18.34!a" -> "1Kgs.18.33!b") mapped to that target. A WLC-side
     * "!b" entry means the opposite - the first part stays at its own
     * number - so identity is the default for pre-note tokens.
     */
    preNoteHome: Map<string, string>;
    /** Every KJV ref claimed as a target by an explicit mapping. */
    claimed: Set<string>;
};

/** Parse morphhb's VerseMap.xml (the WLC <-> KJV versification catalog). */
export function parseVerseMap(xml: string): VerseMapData {
    const wholeVerse = new Map<string, string[]>();
    const preNoteHome = new Map<string, string>();
    const claimed = new Set<string>();

    for (const m of xml.matchAll(/<verse wlc="([^"]+)" kjv="([^"]+)"/g)) {
        const wlc = stripMarker(m[1]);
        const kjv = stripMarker(m[2]);
        const targets = wholeVerse.get(wlc) ?? [];
        if (!targets.includes(kjv)) targets.push(kjv);
        wholeVerse.set(wlc, targets);
        claimed.add(kjv);
        if (m[1].endsWith('!a')) preNoteHome.set(wlc, kjv);
    }
    return { wholeVerse, preNoteHome, claimed };
}

export type MapResult = {
    /** English(KJV)-versification osisId -> ordered unique Strong's tokens. */
    verses: Map<string, string[]>;
    /** WLC refs whose tokens were dropped as Psalm superscriptions. */
    droppedTitles: string[];
};

/**
 * Assign parsed WLC verses to English (KJV) versification.
 *
 * Rules, in order:
 * - A verse WITH boundary notes: each post-note segment goes to the noted
 *   English ref. Pre-note tokens go to the "!a" home from the VerseMap if
 *   one exists, otherwise to the identity ref - EXCEPT Psalm verse 1 whose
 *   first note is its own ref: everything before that note is the
 *   superscription ("A Psalm of David"), which English bibles keep outside
 *   the verse text, so those tokens are dropped.
 * - A verse WITHOUT notes: explicit VerseMap targets when listed;
 *   otherwise identity - EXCEPT unlisted Ps.N.1/Ps.N.2 refs whose identity
 *   target is claimed by an explicit mapping. Those are the separately
 *   numbered Hebrew title verses (Ps.3.1; two-verse titles like Ps.51.1-2)
 *   and are dropped for the same reason.
 */
export function mapWlcToEnglish(wlcVerses: WlcVerse[], verseMap: VerseMapData): MapResult {
    const out = new Map<string, string[]>();
    const droppedTitles: string[] = [];
    const add = (osisId: string, tokens: string[]) => {
        if (tokens.length === 0) return;
        const existing = out.get(osisId);
        if (!existing) {
            out.set(osisId, [...tokens]);
            return;
        }
        for (const t of tokens) {
            if (!existing.includes(t)) existing.push(t);
        }
    };

    for (const v of wlcVerses) {
        if (v.segments.length > 0) {
            if (v.preNote.length > 0) {
                const isPsalmTitle =
                    /^Ps\.\d+\.1$/.test(v.osisId) && v.segments[0].kjv === v.osisId;
                if (isPsalmTitle) {
                    droppedTitles.push(v.osisId);
                } else {
                    add(verseMap.preNoteHome.get(v.osisId) ?? v.osisId, v.preNote);
                }
            }
            for (const seg of v.segments) add(seg.kjv, seg.tokens);
            continue;
        }

        const explicit = verseMap.wholeVerse.get(v.osisId);
        if (explicit) {
            for (const target of explicit) add(target, v.preNote);
        } else if (verseMap.claimed.has(v.osisId) && /^Ps\.\d+\.[12]$/.test(v.osisId)) {
            droppedTitles.push(v.osisId);
        } else {
            add(v.osisId, v.preNote);
        }
    }

    return { verses: out, droppedTitles };
}

/**
 * Parse one Byzantine Majority Text Strong's source file.
 *
 * Line format: "CC.VV word 1234 {N-NSF} word 5678 {V-AAI-3S} ..." -
 * transliterated words, plain-digit Strong's numbers, morphological
 * parsings in braces. Only the digit tokens matter here.
 */
export function parseByzantineBook(text: string, book: string): Map<string, string[]> {
    const verses = new Map<string, string[]>();
    // The upstream files use CRLF endings; \r must not reach the regex
    // because in JavaScript `.` treats it as a line terminator.
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^(\d+)\.(\d+)\s+(.*)$/);
        if (!m) continue;
        const osisId = `${book}.${parseInt(m[1], 10)}.${parseInt(m[2], 10)}`;
        const seen = new Set<string>(verses.get(osisId) ?? []);
        for (const token of m[3].split(/\s+/)) {
            if (/^\d+$/.test(token)) seen.add(`G${parseInt(token, 10)}`);
        }
        verses.set(osisId, [...seen]);
    }
    return verses;
}
