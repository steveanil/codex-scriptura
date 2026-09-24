/**
 * Resource registry (issue #51, decision D2): one entry per resource the
 * app ships, and the descriptor the manifest carries for it.
 *
 * A resource is what the user installs, credits and licenses: a
 * translation, the entity graph, the cross-references, a lexicon. Its
 * datasets (dataset-registry.ts) are how the content is stored. The
 * descriptor's license and provenance are built from the source registry
 * and the accepted checksums rather than written here, so the credits
 * screen cannot drift from what the pipeline actually fetched.
 */

import type { LicenseInfo, ProvenanceSource, ResourceDescriptor, ResourceType } from '@codex-scriptura/core';
import { getSource } from './source-registry.js';
import { SOURCE_CHECKSUMS } from './source-checksums.js';

export type ResourceDefinition = {
    id: string;
    type: ResourceType;
    title: string;
    author?: string;
    publisher?: string;
    description?: string;
    language?: string;
    /**
     * Source registry ids, primary first. The descriptor's license is the
     * primary source's unless `license` says otherwise; every source is
     * listed in the descriptor's provenance with its own license.
     */
    sources: string[];
    /**
     * SPDX id governing the resource as a whole, when its sources mix
     * licenses: the most demanding one. `describeResource` refuses a
     * resource that claims the public domain over a source that asks for
     * credit.
     */
    license?: string;
    /** Attribution wording for the resource as a whole, when one line covers it; each source carries its own. */
    attribution?: string;
};

/** Display name and link for every SPDX id the source registry uses. Adding a source with a new license means adding a row. */
export const LICENSES: Record<string, Omit<LicenseInfo, 'spdx' | 'attribution'>> = {
    'public-domain': { name: 'Public domain' },
    'CC0-1.0': { name: 'Public domain (CC0)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    'CC-BY-SA-3.0': { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
    'CC-BY-SA-4.0': { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    'BSD-2-Clause': { name: 'BSD 2-Clause', url: 'https://opensource.org/license/bsd-2-clause' },
};

export function licenseInfo(spdx: string, attribution?: string): LicenseInfo {
    const known = LICENSES[spdx];
    if (!known) throw new Error(`[resources] No display entry for license "${spdx}". Add it to LICENSES in resource-registry.ts.`);
    return { spdx, ...known, ...(attribution ? { attribution } : {}) };
}

const translation = (id: string, def: Omit<ResourceDefinition, 'id' | 'type' | 'language'>): ResourceDefinition =>
    ({ id, type: 'translation', language: 'en', ...def });

export const RESOURCES: ResourceDefinition[] = [
    translation('kjv', {
        title: 'King James Version',
        description: 'The Authorized King James Version (1769), with the Apocrypha',
        publisher: 'CrossWire Bible Society',
        sources: ['kjv-text'],
    }),
    translation('oeb', {
        title: 'Open English Bible',
        description: 'Open English Bible - a free, open-license modern English translation (in progress: full NT, partial OT)',
        sources: ['oeb-text'],
    }),
    translation('web', {
        title: 'World English Bible',
        description: 'World English Bible - a modern public domain translation',
        publisher: 'eBible.org',
        // The text is eBible's and public domain; its verse-level Strong's
        // tagging is derived from the two morphology sources (issue #134),
        // and the OSHB lemma data is CC BY 4.0, so the resource as shipped
        // carries that obligation.
        sources: ['web-text', 'oshb-morphhb', 'byzantine-majority-text'],
        license: 'CC-BY-4.0',
    }),
    translation('bsb', {
        title: 'Berean Standard Bible',
        description: 'Berean Standard Bible - a modern, readable translation released into the public domain in 2023',
        publisher: 'Bible Hub',
        sources: ['bsb-text'],
    }),
    translation('asv', {
        title: 'American Standard Version',
        description: 'American Standard Version (1901) - the classic formal-equivalence revision of the KJV',
        sources: ['asv-text'],
    }),
    translation('ylt', {
        title: "Young's Literal Translation",
        author: 'Robert Young',
        description: "Young's Literal Translation (1898) - a hyper-literal study translation",
        sources: ['ylt-text'],
    }),
    translation('dby', {
        title: 'Darby Translation',
        author: 'John Nelson Darby',
        description: "Darby Translation (1890) - John Nelson Darby's formal translation",
        sources: ['dby-text'],
    }),
    {
        id: 'theographic',
        type: 'entities',
        title: 'Theographic Bible Metadata',
        author: 'Robert Rouse',
        description: 'People, places and events of the Bible with their verse references, geocoded from OpenBible and enriched with name meanings from BibleData',
        language: 'en',
        sources: ['theographic', 'openbible-geo', 'bibledata'],
    },
    {
        id: 'eastons',
        type: 'dictionary',
        title: "Easton's Bible Dictionary",
        author: 'Matthew George Easton',
        description: "Easton's Bible Dictionary (1897), as distributed with Theographic",
        language: 'en',
        sources: ['theographic'],
    },
    {
        id: 'cross-references',
        type: 'cross-references',
        title: 'Cross-references',
        description: 'Verse-to-verse links from the Treasury of Scripture Knowledge via OpenBible, typed with the OT-NT Reference Map and the UBS parallel passages',
        sources: ['openbible-xref', 'otnt-reference-map', 'ubs-parallel-passages'],
        // The merged dataset is a derivative of all three; the share-alike source governs the whole
        license: 'CC-BY-SA-4.0',
    },
    {
        id: 'genealogy',
        type: 'genealogy',
        title: 'Genealogy',
        description: 'Family relationships from the Theographic person records, supplemented with BibleData ancestor and sibling edges',
        sources: ['theographic', 'bibledata'],
    },
    {
        id: 'strongs-hebrew',
        type: 'lexicon',
        title: "Strong's Hebrew Lexicon",
        author: 'James Strong',
        description: "Strong's Hebrew dictionary entries with lemma, transliteration, pronunciation and gloss",
        sources: ['bibledata'],
    },
    {
        id: 'strongs-greek',
        type: 'lexicon',
        title: "Strong's Greek Lexicon",
        author: 'James Strong',
        description: "Strong's Greek dictionary entries with lemma, transliteration, pronunciation and gloss",
        sources: ['openscriptures-greek'],
    },
    {
        id: 'naves',
        type: 'topical-index',
        title: "Nave's Topical Bible",
        author: 'Orville J. Nave',
        publisher: 'CrossWire Bible Society',
        description: 'Topical index of about 5,300 topics with some 100,000 scripture references',
        language: 'en',
        sources: ['naves'],
    },
];

export function getResourceDefinition(id: string): ResourceDefinition {
    const def = RESOURCES.find((r) => r.id === id);
    if (!def) throw new Error(`[resources] Unknown resource "${id}". Register it in resource-registry.ts.`);
    return def;
}

function provenanceOf(sourceId: string): ProvenanceSource {
    const s = getSource(sourceId);
    const accepted = s.checksum ? SOURCE_CHECKSUMS[s.checksum] : undefined;
    if (s.checksum && !accepted) throw new Error(`[resources] Source "${sourceId}" names checksum key "${s.checksum}", which source-checksums.ts does not hold.`);
    return {
        sourceId,
        name: s.name,
        url: s.url,
        license: s.license,
        ...(s.attribution ? { attribution: s.attribution } : {}),
        ...(s.licenseNotice ? { licenseNotice: s.licenseNotice } : {}),
        ...(s.version ? { version: s.version } : {}),
        ...(accepted ? { accepted: accepted.accepted, checksum: accepted.sha256 } : {}),
    };
}

const NO_OBLIGATIONS = new Set(['public-domain', 'CC0-1.0']);

/** The SPDX id that governs the resource as a whole. */
export function resourceLicense(def: ResourceDefinition): string {
    return def.license ?? getSource(def.sources[0]).license;
}

/**
 * Build the descriptor the manifest ships; `version` comes from the
 * resource's published datasets. A resource whose governing license
 * carries no obligations cannot be built from a source whose license
 * does: the user receives the whole resource, so the whole must carry
 * the strictest source's terms.
 */
export function describeResource(def: ResourceDefinition, version: string): ResourceDescriptor {
    if (def.sources.length === 0) throw new Error(`[resources] Resource "${def.id}" lists no sources.`);
    const governing = resourceLicense(def);
    if (NO_OBLIGATIONS.has(governing)) {
        const obliging = def.sources.filter((id) => !NO_OBLIGATIONS.has(getSource(id).license));
        if (obliging.length > 0) {
            throw new Error(`[resources] Resource "${def.id}" claims ${governing} but ${obliging.join(', ')} require attribution. Set its license to the governing one.`);
        }
    }
    return {
        id: def.id,
        type: def.type,
        title: def.title,
        ...(def.author ? { author: def.author } : {}),
        ...(def.publisher ? { publisher: def.publisher } : {}),
        ...(def.description ? { description: def.description } : {}),
        ...(def.language ? { language: def.language } : {}),
        license: licenseInfo(governing, def.attribution),
        provenance: def.sources.map(provenanceOf),
        version,
    };
}
