/**
 * What the library weighs, per item (Settings > Storage). Index caches and
 * annotations are measured exactly from their JSON; verse text is summed
 * from the records and marked approximate, since IndexedDB's own overhead
 * is not observable from a page.
 */
import { db } from '@codex-scriptura/db';

export type StorageItem = {
    id: string;
    label: string;
    kind: 'translation' | 'annotations' | 'index' | 'graph';
    bytes: number;
    approx: boolean;
    detail: string;
};

const RECORD_OVERHEAD = 64;

export async function measureStorage(installedTranslations: { id: string; abbreviation: string }[]): Promise<StorageItem[]> {
    const items: StorageItem[] = [];

    for (const t of installedTranslations) {
        let bytes = 0;
        let verses = 0;
        await db.verses.where('translationId').equals(t.id).each((v) => {
            verses++;
            bytes += v.text.length + (v.lemmas?.length ?? 0) + (v.align?.length ?? 0) + (v.wj?.length ?? 0) + RECORD_OVERHEAD;
        });
        items.push({ id: `translation:${t.id}`, label: t.abbreviation, kind: 'translation', bytes, approx: true, detail: `${verses.toLocaleString()} verses` });
    }

    const [annotations, tags, searches] = await Promise.all([db.annotations.toArray(), db.tags.toArray(), db.savedSearches.toArray()]);
    items.push({
        id: 'annotations',
        label: 'Annotations',
        kind: 'annotations',
        bytes: JSON.stringify(annotations).length + JSON.stringify(tags).length + JSON.stringify(searches).length,
        approx: false,
        detail: `${annotations.length.toLocaleString()} annotations`,
    });

    const indexes = await db.searchIndexes.toArray();
    items.push({
        id: 'index',
        label: 'Search index',
        kind: 'index',
        bytes: indexes.reduce((s, i) => s + i.serializedIndex.length, 0),
        approx: false,
        detail: indexes.length ? [...new Set(indexes.map((i) => i.translationId))].join(', ') : 'not built yet',
    });

    const [persons, places, events, relationships] = await Promise.all([
        db.persons.count(), db.places.count(), db.events.count(), db.relationships.count(),
    ]);
    let graphBytes = 0;
    await db.persons.each((p) => { graphBytes += JSON.stringify(p).length; });
    await db.places.each((p) => { graphBytes += JSON.stringify(p).length; });
    await db.events.each((e) => { graphBytes += JSON.stringify(e).length; });
    await db.relationships.each((r) => { graphBytes += JSON.stringify(r).length; });
    items.push({
        id: 'graph',
        label: 'Entity graph',
        kind: 'graph',
        bytes: graphBytes,
        approx: true,
        detail: `${persons.toLocaleString()} people, ${places.toLocaleString()} places, ${events.toLocaleString()} events, ${relationships.toLocaleString()} links`,
    });

    return items;
}
