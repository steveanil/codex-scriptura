/**
 * Golden-anchor comparison (issue #213 class: silent upstream rewording).
 *
 * An anchor pins the exact text of a verse, optionally the Strong's tokens
 * it must and must not carry, and the English surface each aligned lemma
 * must cover. golden-texts.test.ts runs these over the processed output;
 * this module keeps the comparison pure so the detection itself is unit
 * tested against a reworded fixture.
 */

export type GoldenAnchor = {
    osisId: string;
    text: string;
    lemmas?: string[];
    /** Tokens that must NOT appear (e.g. Psalm superscription words, issue #134). */
    absentLemmas?: string[];
    /** Word-alignment anchors: a span carrying `strongs` must slice to text containing `surface`. */
    align?: Array<{ strongs: string; surface: string }>;
};

export type GoldenVerse = { osisId: string; text: string; lemmas?: string; align?: string };

/** Every way `verse` departs from its anchor; empty means the anchor holds. */
export function checkGolden(verse: GoldenVerse | undefined, anchor: GoldenAnchor): string[] {
    if (!verse) return [`${anchor.osisId}: verse missing from the corpus`];
    const problems: string[] = [];
    if (verse.text !== anchor.text) {
        problems.push(`${anchor.osisId}: text changed\n  expected: ${anchor.text}\n  actual:   ${verse.text}`);
    }
    const tokens = new Set((verse.lemmas ?? '').split(' ').filter(Boolean));
    for (const t of anchor.lemmas ?? []) {
        if (!tokens.has(t)) problems.push(`${anchor.osisId}: missing lemma ${t}`);
    }
    for (const t of anchor.absentLemmas ?? []) {
        if (tokens.has(t)) problems.push(`${anchor.osisId}: carries out-of-verse lemma ${t}`);
    }
    if (anchor.align) {
        const spans = parseSpans(verse.align);
        for (const { strongs, surface } of anchor.align) {
            const hit = spans.find(([, , ids]) => ids.split(' ').includes(strongs));
            if (!hit) problems.push(`${anchor.osisId}: no span carries ${strongs}`);
            else if (!verse.text.slice(hit[0], hit[1]).includes(surface)) {
                problems.push(`${anchor.osisId}: ${strongs} aligns to "${verse.text.slice(hit[0], hit[1])}", expected "${surface}"`);
            }
        }
    }
    return problems;
}

function parseSpans(align: string | undefined): [number, number, string][] {
    if (!align) return [];
    try {
        const parsed = JSON.parse(align);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
