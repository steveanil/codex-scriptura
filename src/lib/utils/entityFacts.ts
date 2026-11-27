import { BOOKS, compareCanonical, parseOsisId, type ResourceDescriptor, type SourceRef } from '@codex-scriptura/core';

export type BookAppearance = {
    book: string;
    name: string;
    /** Distinct verses in this book. */
    count: number;
    /** Earliest reference in the book, the one a row navigates to. */
    first: { chapter: number; verse: number };
};

const BOOK_NAMES = new Map(BOOKS.map((b) => [b.osisId, b.name]));

/**
 * An entity's verse references grouped by book in canonical order. The
 * stored list is not sorted (events follow narrative order), so the first
 * reference of a book is the canonical minimum, not the first in the array.
 */
export function groupRefsByBook(verseRefs: readonly string[]): BookAppearance[] {
    const seen = new Set<string>();
    const refs = [];
    for (const id of verseRefs) {
        if (seen.has(id)) continue;
        seen.add(id);
        const ref = parseOsisId(id);
        if (ref) refs.push(ref);
    }
    refs.sort(compareCanonical);

    const groups: BookAppearance[] = [];
    for (const r of refs) {
        const last = groups.at(-1);
        if (last && last.book === r.book) {
            last.count++;
        } else {
            groups.push({ book: r.book, name: BOOK_NAMES.get(r.book) ?? r.book, count: 1, first: { chapter: r.chapter, verse: r.verse } });
        }
    }
    return groups;
}

/** "54 verses in 6 books" */
export function appearanceSummary(groups: readonly BookAppearance[]): string {
    const verses = groups.reduce((n, g) => n + g.count, 0);
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    return `${plural(verses, 'verse')} in ${plural(groups.length, 'book')}`;
}

/** Record fields the entity panel shows, in panel order, with their reader-facing names. */
const SHOWN_FIELDS: Array<[string, string]> = [
    ['nameMeaning', 'name meaning'],
    ['lat', 'coordinates'],
    ['confidence', 'location certainty'],
    ['date', 'date'],
    ['verseRefs', 'verses'],
    ['description', 'description'],
];

export type SourceCredit = {
    /** Reader-facing field names this source supplied, e.g. ["coordinates", "verses"]. */
    fields: string[];
    name: string;
    /** The dataset that distributed the text, when the text is a work of its own. */
    via?: string;
};

/**
 * Who supplied each shown field, named as the resource descriptors name
 * them (the same registry the Credits screen reads). `descriptionIsDictionary`
 * marks a description that is dictionary text carried by its source
 * (Theographic ships Easton's entries for people and places), so it is
 * credited to the dictionary resource with the carrier as "via".
 * Sources the registry does not know are left out rather than shown by id.
 */
export function sourceCredits(
    sources: readonly SourceRef[] | undefined,
    resources: ReadonlyMap<string, ResourceDescriptor>,
    descriptionIsDictionary: boolean,
): SourceCredit[] {
    const provenanceName = new Map<string, string>();
    for (const r of resources.values()) for (const p of r.provenance) if (!provenanceName.has(p.sourceId)) provenanceName.set(p.sourceId, p.name);

    const credits: SourceCredit[] = [];
    const add = (name: string, field: string, via?: string) => {
        const hit = credits.find((c) => c.name === name && c.via === via);
        if (hit) {
            if (!hit.fields.includes(field)) hit.fields.push(field);
        } else {
            credits.push({ fields: [field], name, via });
        }
    };

    for (const [key, label] of SHOWN_FIELDS) {
        for (const src of sources ?? []) {
            if (!src.fields.includes(key)) continue;
            const name = provenanceName.get(src.sourceId);
            if (!name) continue;
            if (key === 'description' && descriptionIsDictionary) {
                const dict = [...resources.values()].find((r) => r.type === 'dictionary' && r.provenance.some((p) => p.sourceId === src.sourceId));
                if (dict) {
                    add(dict.title, label, name);
                    continue;
                }
            }
            add(name, label);
        }
    }
    return credits;
}

/** Credits without the fields the panel does not render; a source left with none is dropped. */
export function withoutFields(credits: readonly SourceCredit[], hidden: readonly string[]): SourceCredit[] {
    return credits
        .map((c) => ({ ...c, fields: c.fields.filter((f) => !hidden.includes(f)) }))
        .filter((c) => c.fields.length > 0);
}

/** The dictionary resource's title, for a description taken from the dictionary table directly. */
export function dictionaryTitle(resources: ReadonlyMap<string, ResourceDescriptor>): string | null {
    for (const r of resources.values()) if (r.type === 'dictionary') return r.title;
    return null;
}
