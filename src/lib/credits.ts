/**
 * The Credits screen (issue #235): what the app ships, where it came from
 * and under which terms, read from the resource descriptors (issue #51)
 * so it cannot drift from what the pipeline fetched. Translations first,
 * then the shared datasets, each alphabetical by title.
 */
import type { ProvenanceSource, ResourceDescriptor, ResourceType } from '@codex-scriptura/core';

const TYPE_LABELS: Partial<Record<ResourceType, string>> = {
    translation: 'Translation',
    commentary: 'Commentary',
    lexicon: 'Lexicon',
    dictionary: 'Dictionary',
    'cross-references': 'Cross-references',
    entities: 'People, places and events',
    genealogy: 'Genealogy',
    'topical-index': 'Topical index',
    manuscript: 'Manuscript',
    patristic: 'Church Fathers',
    map: 'Map',
    lectionary: 'Lectionary',
    audio: 'Audio',
};

export function resourceTypeLabel(type: ResourceType): string {
    return TYPE_LABELS[type] ?? type;
}

/** "Pinned at 3d15126" for a commit, "Accepted 2026-07-22" for a reviewed download, empty when neither. */
export function sourceIdentity(source: ProvenanceSource): string {
    if (source.version) return `Pinned at ${source.version.slice(0, 7)}`;
    if (source.accepted) return `Accepted ${source.accepted}`;
    return '';
}

export type CreditItem = {
    resource: ResourceDescriptor;
    typeLabel: string;
    /** "by Robert Rouse", "CrossWire Bible Society", or both joined; empty when the descriptor names neither. */
    byline: string;
    installed: boolean;
};

export type CreditGroup = { label: string; items: CreditItem[] };

function byline(r: ResourceDescriptor): string {
    return [r.author ? `by ${r.author}` : '', r.publisher ?? ''].filter(Boolean).join(' · ');
}

const byTitle = (a: CreditItem, b: CreditItem) => a.resource.title.localeCompare(b.resource.title);

export function creditGroups(resources: ResourceDescriptor[], installed: Set<string>): CreditGroup[] {
    const items = resources.map((resource): CreditItem => ({
        resource,
        typeLabel: resourceTypeLabel(resource.type),
        byline: byline(resource),
        installed: installed.has(resource.id),
    }));
    const translations = items.filter((i) => i.resource.type === 'translation').sort(byTitle);
    const datasets = items.filter((i) => i.resource.type !== 'translation').sort(byTitle);
    return [
        ...(translations.length ? [{ label: 'Translations', items: translations }] : []),
        ...(datasets.length ? [{ label: 'Datasets', items: datasets }] : []),
    ];
}
