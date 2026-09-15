/**
 * Typed cross-reference overlay parsers.
 *
 * Parses two external datasets into a unified lookup map that the
 * cross-reference importer consults before falling back to heuristics.
 *
 * ── OT-NT-Reference-Map ──────────────────────────────────────
 *
 * Source: https://github.com/balinjdl/OT-NT-Reference-Map
 * Format: JS file with links.push({ linkID, bkSource, chpSource, bkTarget, chpTarget, type? })
 * Types: "q" (quotation), "a" (allusion), "p" (possible allusion)
 * Granularity: chapter-level only → we expand to all verse pairs within those chapters
 *
 * ── UBS Parallel Passages ────────────────────────────────────
 *
 * Source: https://github.com/ubsicap/ubs-open-license
 * Format: XML with <Passage> groups containing <Verse HEB="..."> or <Verse GRK="...">
 * The HEB/GRK attribute is one digit per word of that verse, scoring how
 * the word matches the parallel text: 0 = no match, 1 = partial, 2 = full
 * (3-5 and 6-8 repeat those three levels with line-break hints for
 * display, so level = digit mod 3). There are no explicit types; we derive:
 *   - Cross-testament groups (HEB + GRK): "quotation" when the NT verse's
 *     word matches show verbatim reuse (see ubsCrossTestamentType),
 *     otherwise "allusion". Low scores are not evidence against a
 *     quotation - NT authors often render the Hebrew independently of the
 *     LXX (Matt 8:17 / Isa 53:4 matches 0 words) - so a weak UBS pair never
 *     outranks an OT-NT-Reference-Map quotation.
 *   - Same-testament groups → "parallel"
 * UBS keys Hebrew-Bible verses by BHS versification (Ps 22:2, Joel 3:1),
 * which differs from OpenBible's English numbering in Psalms and a few
 * prophets; those pairs miss the verse-pair lookup and fall through to the
 * chapter pair.
 *
 * ── Lookup map ───────────────────────────────────────────────
 *
 * The overlay produces a Map<string, OverlayType> keyed by:
 *   - Chapter-pair key: "Matt.1→Isa.7" (from OT-NT-Reference-Map)
 *   - Verse-pair key: "Gen.1.27→Matt.19.4" (from UBS)
 *
 * The importer checks verse-pair first (more specific), then chapter-pair,
 * and lookupOverlay reports which level answered so the classifier can
 * treat chapter-level labels as the weaker evidence they are.
 */

import fs from 'node:fs';

// ── Types ────────────────────────────────────────────────────

export type OverlayType = 'quotation' | 'allusion' | 'possible_allusion' | 'parallel';

export interface TypeOverlay {
    /** Verse-pair key → type (most specific, from UBS) */
    versePairs: Map<string, OverlayType>;
    /** Chapter-pair key → type (from OT-NT-Reference-Map) */
    chapterPairs: Map<string, OverlayType>;
    stats: {
        otntEntries: number;
        ubsGroups: number;
        ubsVersePairs: number;
    };
}

// ── OT-NT-Reference-Map book code → OSIS mapping ────────────

const OTNT_TO_OSIS: Record<string, string> = {
    // OT
    OTGen: 'Gen', OTExo: 'Exod', OTLev: 'Lev', OTNum: 'Num', OTDeu: 'Deut',
    OTJos: 'Josh', OTJdg: 'Judg', OTRut: 'Ruth',
    OT1Sa: '1Sam', OT2Sa: '2Sam', OT1Ki: '1Kgs', OT2Ki: '2Kgs',
    OT1Ch: '1Chr', OT2Ch: '2Chr', OTEzr: 'Ezra', OTNeh: 'Neh', OTEst: 'Esth',
    OTJob: 'Job', OTPsa: 'Ps', OTPro: 'Prov', OTEcc: 'Eccl', OTSng: 'Song',
    OTIsa: 'Isa', OTJer: 'Jer', OTLam: 'Lam', OTEze: 'Ezek', OTDan: 'Dan',
    OTHos: 'Hos', OTJoe: 'Joel', OTAmo: 'Amos', OTOba: 'Obad', OTJon: 'Jonah',
    OTMic: 'Mic', OTNah: 'Nah', OTHab: 'Hab', OTZep: 'Zeph', OTHag: 'Hag',
    OTZec: 'Zech', OTMal: 'Mal',
    // NT
    NTMt: 'Matt', NTMk: 'Mark', NTLk: 'Luke', NTJn: 'John', NTAc: 'Acts',
    NTRo: 'Rom', NT1Co: '1Cor', NT2Co: '2Cor', NTGa: 'Gal', NTEp: 'Eph',
    NTPh: 'Phil', NTCo: 'Col', NT1Th: '1Thess', NT2Th: '2Thess',
    NT1Ti: '1Tim', NT2Ti: '2Tim', NTTi: 'Titus', NTPm: 'Phlm',
    NTHeb: 'Heb', NTJa: 'Jas', NT1Pe: '1Pet', NT2Pe: '2Pet',
    NT1Jn: '1John', NT2Jn: '2John', NT3Jn: '3John', NTJu: 'Jude', NTRe: 'Rev',
};

// ── UBS book code → OSIS mapping ─────────────────────────────

const UBS_TO_OSIS: Record<string, string> = {
    GEN: 'Gen', EXO: 'Exod', LEV: 'Lev', NUM: 'Num', DEU: 'Deut',
    JOS: 'Josh', JDG: 'Judg', RUT: 'Ruth',
    '1SA': '1Sam', '2SA': '2Sam', '1KI': '1Kgs', '2KI': '2Kgs',
    '1CH': '1Chr', '2CH': '2Chr', EZR: 'Ezra', NEH: 'Neh', EST: 'Esth',
    JOB: 'Job', PSA: 'Ps', PRO: 'Prov', ECC: 'Eccl', SNG: 'Song',
    ISA: 'Isa', JER: 'Jer', LAM: 'Lam', EZK: 'Ezek', DAN: 'Dan',
    HOS: 'Hos', JOL: 'Joel', AMO: 'Amos', OBA: 'Obad', JON: 'Jonah',
    MIC: 'Mic', NAM: 'Nah', HAB: 'Hab', ZEP: 'Zeph', HAG: 'Hag',
    ZEC: 'Zech', MAL: 'Mal',
    MAT: 'Matt', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts',
    ROM: 'Rom', '1CO': '1Cor', '2CO': '2Cor', GAL: 'Gal', EPH: 'Eph',
    PHP: 'Phil', COL: 'Col', '1TH': '1Thess', '2TH': '2Thess',
    '1TI': '1Tim', '2TI': '2Tim', TIT: 'Titus', PHM: 'Phlm',
    HEB: 'Heb', JAS: 'Jas', '1PE': '1Pet', '2PE': '2Pet',
    '1JN': '1John', '2JN': '2John', '3JN': '3John', JUD: 'Jude', REV: 'Rev',
};

// ── Parse OT-NT-Reference-Map ────────────────────────────────

function parseOtntReferenceMap(content: string): Map<string, OverlayType> {
    const map = new Map<string, OverlayType>();

    // Extract links.push({...}) calls
    const pushRegex = /links\.push\(\s*\{([^}]+)\}\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = pushRegex.exec(content)) !== null) {
        const body = match[1];

        const bkSource = extractField(body, 'bkSource');
        const chpSource = extractField(body, 'chpSource');
        const bkTarget = extractField(body, 'bkTarget');
        const chpTarget = extractField(body, 'chpTarget');
        const typeCode = extractField(body, 'type');

        if (!bkSource || !chpSource || !bkTarget || !chpTarget) continue;

        const srcOsis = OTNT_TO_OSIS[bkSource];
        const tgtOsis = OTNT_TO_OSIS[bkTarget];
        if (!srcOsis || !tgtOsis) continue;

        // Map type code to our type
        let overlayType: OverlayType;
        switch (typeCode) {
            case 'q': overlayType = 'quotation'; break;
            case 'a': overlayType = 'allusion'; break;
            case 'p': overlayType = 'possible_allusion'; break;
            default:  overlayType = 'allusion'; break; // untyped entries treated as allusion
        }

        // Store as chapter-pair key (both directions)
        const key1 = `${srcOsis}.${chpSource}→${tgtOsis}.${chpTarget}`;
        const key2 = `${tgtOsis}.${chpTarget}→${srcOsis}.${chpSource}`;

        // Don't overwrite a stronger type with a weaker one
        for (const key of [key1, key2]) {
            const existing = map.get(key);
            if (!existing || OVERLAY_PRIORITY[overlayType] > OVERLAY_PRIORITY[existing]) {
                map.set(key, overlayType);
            }
        }
    }

    return map;
}

function extractField(body: string, field: string): string | null {
    // Match both quoted and unquoted values
    const regex = new RegExp(`"${field}"\\s*:\\s*(?:"([^"]*)"|(\\d+))`);
    const m = body.match(regex);
    if (m) return m[1] ?? m[2];
    return null;
}

// ── Parse UBS Parallel Passages ──────────────────────────────

export interface MatchProfile {
    /** Words in the verse (one digit each). */
    words: number;
    /** Words with a full match in the parallel text. */
    full: number;
    /** Longest run of consecutive fully matched words. */
    longestRun: number;
}

/** Decode a UBS per-word match string (see the header for the digit legend). */
export function matchProfile(digits: string): MatchProfile {
    let full = 0, run = 0, longestRun = 0;
    for (const ch of digits) {
        const level = Number(ch) % 3;
        if (level === 2) {
            full++;
            run++;
            if (run > longestRun) longestRun = run;
        } else {
            run = 0;
        }
    }
    return { words: digits.length, full, longestRun };
}

/**
 * Quotation thresholds on the NT (quoting) verse: at least half its words
 * fully match the OT text, or a clause of five consecutive words does.
 * Calibrated on the 326 UBS cross-testament pairs present in OpenBible:
 * Luke 4:18 / Isa 61:1 is 18 of 22, Matt 19:4 / Gen 1:27 is 8 of 16 with
 * a run of 7 (the quoted clause), Heb 11:5 / Gen 5:24 is 8 of 23 with a
 * run of 4 (a paraphrase). Half the pairs pass.
 */
const QUOTATION_MIN_FULL_FRACTION = 0.5;
const QUOTATION_MIN_RUN = 5;

/** Type a cross-testament UBS pair from the NT verse's word matches. */
export function ubsCrossTestamentType(ntDigits: string): OverlayType {
    const p = matchProfile(ntDigits);
    if (p.words === 0) return 'allusion';
    if (p.full / p.words >= QUOTATION_MIN_FULL_FRACTION || p.longestRun >= QUOTATION_MIN_RUN) return 'quotation';
    return 'allusion';
}

/** Parse a UBS verse reference like "GEN 1:27" or "MAT 19:4-5" → "Gen.1.27" */
function parseUbsRef(text: string): string | null {
    const trimmed = text.trim();
    // Match "BOOK CH:VS" or "BOOK CH:VS-VS2" or "BOOK CH:VS-BOOK2 CH2:VS2"
    const m = trimmed.match(/^(\w+)\s+(\d+):(\d+)/);
    if (!m) return null;

    const book = UBS_TO_OSIS[m[1]];
    if (!book) return null;

    return `${book}.${m[2]}.${m[3]}`;
}

function parseUbsParallelPassages(content: string): {
    versePairs: Map<string, OverlayType>;
    groupCount: number;
} {
    const versePairs = new Map<string, OverlayType>();
    let groupCount = 0;

    // Simple XML parsing - extract <Passage> groups
    const passageRegex = /<Passage>([\s\S]*?)<\/Passage>/g;
    let passageMatch: RegExpExecArray | null;

    while ((passageMatch = passageRegex.exec(content)) !== null) {
        groupCount++;
        const passageBody = passageMatch[1];

        // Extract all verses in this group
        const verseRegex = /<Verse\s+(HEB|GRK)="([^"]*)">([^<]+)<\/Verse>/g;
        let verseMatch: RegExpExecArray | null;

        const otVerses: string[] = [];
        const ntVerses: Array<{ ref: string; digits: string }> = [];

        while ((verseMatch = verseRegex.exec(passageBody)) !== null) {
            const lang = verseMatch[1];
            const ref = parseUbsRef(verseMatch[3]);
            if (!ref) continue;

            if (lang === 'HEB') otVerses.push(ref);
            else ntVerses.push({ ref, digits: verseMatch[2] });
        }

        // Determine type based on testament composition
        if (otVerses.length > 0 && ntVerses.length > 0) {
            // Cross-testament group (OT-in-NT): the NT verse's word matches
            // decide quotation vs allusion. The digits describe the verse
            // against the whole group, so every OT verse in it gets the
            // same label; a stronger label from another group wins.
            for (const nt of ntVerses) {
                const type = ubsCrossTestamentType(nt.digits);
                for (const ot of otVerses) {
                    for (const key of [`${ot}→${nt.ref}`, `${nt.ref}→${ot}`]) {
                        if (type === 'quotation' || !versePairs.has(key)) versePairs.set(key, type);
                    }
                }
            }
        } else {
            // Same-testament group → parallel
            const all = [...otVerses, ...ntVerses.map((v) => v.ref)];
            for (let i = 0; i < all.length; i++) {
                for (let j = i + 1; j < all.length; j++) {
                    const key1 = `${all[i]}→${all[j]}`;
                    const key2 = `${all[j]}→${all[i]}`;
                    if (!versePairs.has(key1)) versePairs.set(key1, 'parallel');
                    if (!versePairs.has(key2)) versePairs.set(key2, 'parallel');
                }
            }
        }
    }

    return { versePairs, groupCount };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Build the type overlay from both external datasets.
 *
 * @param otntPath  Path to otnt-reference-map.js
 * @param ubsPath   Path to ParallelPassages.xml
 * @returns Unified TypeOverlay for the importer to consult
 */
export function buildTypeOverlay(otntPath: string, ubsPath: string): TypeOverlay {
    let chapterPairs = new Map<string, OverlayType>();
    let otntEntries = 0;

    if (fs.existsSync(otntPath)) {
        const content = fs.readFileSync(otntPath, 'utf-8');
        chapterPairs = parseOtntReferenceMap(content);
        otntEntries = chapterPairs.size / 2; // each entry stored in both directions
        console.log(`[typed-overlay] OT-NT-Reference-Map: ${otntEntries} chapter-pair entries`);
    } else {
        console.log(`[typed-overlay] OT-NT-Reference-Map not found at ${otntPath} - skipping`);
    }

    let versePairs = new Map<string, OverlayType>();
    let ubsGroups = 0;

    if (fs.existsSync(ubsPath)) {
        const content = fs.readFileSync(ubsPath, 'utf-8');
        const ubs = parseUbsParallelPassages(content);
        versePairs = ubs.versePairs;
        ubsGroups = ubs.groupCount;
        console.log(`[typed-overlay] UBS Parallel Passages: ${ubsGroups} groups → ${versePairs.size / 2} verse-pair entries`);
    } else {
        console.log(`[typed-overlay] UBS Parallel Passages not found at ${ubsPath} - skipping`);
    }

    return {
        versePairs,
        chapterPairs,
        stats: {
            otntEntries,
            ubsGroups,
            ubsVersePairs: versePairs.size / 2,
        },
    };
}

export interface OverlayHit {
    type: OverlayType;
    /** Whether the deciding entry keyed the exact verse pair or only the chapters. */
    level: 'verse' | 'chapter';
}

const OVERLAY_PRIORITY: Record<OverlayType, number> = {
    quotation: 3,
    allusion: 2,
    possible_allusion: 1,
    parallel: 0,
};

/**
 * Look up the overlay entry for a cross-reference pair.
 *
 * Checks both verse-pair (UBS) and chapter-pair (OT-NT-Reference-Map),
 * then returns the higher-priority type when both match, along with the
 * level that supplied it.
 *
 * Merging matters because a weak UBS word match is not evidence against
 * a quotation (see the header), while OT-NT-Reference-Map carries
 * curated "quotation" labels. Without merging, a UBS verse-pair allusion
 * would shadow the curated chapter-pair quotation.
 */
export function lookupOverlay(
    overlay: TypeOverlay,
    sourceVerse: string,
    targetVerse: string,
): OverlayHit | null {
    // 1. Exact verse-pair match (UBS)
    const verseKey = `${sourceVerse}→${targetVerse}`;
    const verseType = overlay.versePairs.get(verseKey) ?? null;

    // 2. Chapter-pair match (OT-NT-Reference-Map)
    let chapterType: OverlayType | null = null;
    const srcParts = sourceVerse.split('.');
    const tgtParts = targetVerse.split('.');
    if (srcParts.length >= 2 && tgtParts.length >= 2) {
        const chapterKey = `${srcParts[0]}.${srcParts[1]}→${tgtParts[0]}.${tgtParts[1]}`;
        chapterType = overlay.chapterPairs.get(chapterKey) ?? null;
    }

    // 3. When both sources match, use the higher-priority type
    if (verseType && chapterType) {
        return OVERLAY_PRIORITY[chapterType] > OVERLAY_PRIORITY[verseType]
            ? { type: chapterType, level: 'chapter' }
            : { type: verseType, level: 'verse' };
    }
    if (verseType) return { type: verseType, level: 'verse' };
    if (chapterType) return { type: chapterType, level: 'chapter' };
    return null;
}

/** Overlay type only, for callers that do not care which level answered. */
export function lookupOverlayType(
    overlay: TypeOverlay,
    sourceVerse: string,
    targetVerse: string,
): OverlayType | null {
    return lookupOverlay(overlay, sourceVerse, targetVerse)?.type ?? null;
}
