import { describe, it, expect } from 'vitest';
import { RESOURCES, LICENSES, describeResource, getResourceDefinition, licenseInfo, resourceLicense } from './resource-registry.js';
import { SOURCES } from './source-registry.js';
import { SOURCE_CHECKSUMS } from './source-checksums.js';
import { UNPINNABLE_SOURCE_FILES } from './checksums.js';
import { DATASETS } from './dataset-registry.js';

describe('resource registry (issue #51)', () => {
    it('has unique ids, and every source it names is registered', () => {
        const ids = RESOURCES.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const r of RESOURCES) {
            expect(r.sources.length, r.id).toBeGreaterThan(0);
            for (const s of r.sources) expect(SOURCES[s], `${r.id} names source ${s}`).toBeDefined();
        }
    });

    it('every resource owns at least one dataset, and every dataset names a registered resource', () => {
        const owned = new Set(DATASETS.map((d) => d.resource));
        for (const r of RESOURCES) expect(owned.has(r.id), `${r.id} owns no dataset`).toBe(true);
        for (const d of DATASETS) expect(() => getResourceDefinition(d.resource), d.id).not.toThrow();
    });

    it('every license the source registry uses has a display entry', () => {
        for (const s of Object.values(SOURCES)) expect(LICENSES[s.license], `${s.id}: ${s.license}`).toBeDefined();
        for (const r of RESOURCES) expect(() => licenseInfo(resourceLicense(r))).not.toThrow();
        expect(() => licenseInfo('MIT')).toThrow(/No display entry/);
    });

    it('every unpinnable source names its accepted checksum, and vice versa', () => {
        const keyed = Object.values(SOURCES).flatMap((s) => (s.checksum ? [s.checksum] : []));
        expect(keyed.sort()).toEqual([...UNPINNABLE_SOURCE_FILES].sort());
        for (const key of keyed) expect(SOURCE_CHECKSUMS[key], key).toBeDefined();
        for (const s of Object.values(SOURCES)) expect(!!s.version || !!s.checksum, `${s.id} is neither pinned nor checksum-accepted`).toBe(true);
    });

    it('builds provenance from the source registry: a pin for pinned hosts, the accepted checksum for the others', () => {
        const web = describeResource(getResourceDefinition('web'), 'v1');
        expect(web.license).toEqual({ spdx: 'public-domain', name: 'Public domain' });
        expect(web.provenance.map((p) => p.sourceId)).toEqual(['web-text', 'oshb-morphhb', 'byzantine-majority-text']);
        expect(web.provenance[0]).toMatchObject({ license: 'public-domain', accepted: SOURCE_CHECKSUMS['eng-web.usfx.xml'].accepted, checksum: SOURCE_CHECKSUMS['eng-web.usfx.xml'].sha256 });
        expect(web.provenance[0].version).toBeUndefined();
        expect(web.provenance[1]).toMatchObject({ license: 'CC-BY-4.0', version: SOURCES['oshb-morphhb'].version });
        expect(web.provenance[1].checksum).toBeUndefined();
        expect(web.version).toBe('v1');
    });

    it('lets a mixed-license resource state the license that governs the whole', () => {
        const xrefs = describeResource(getResourceDefinition('cross-references'), 'v1');
        expect(xrefs.license.spdx).toBe('CC-BY-SA-4.0');
        expect(xrefs.provenance.map((p) => p.license)).toEqual(['CC-BY-4.0', 'BSD-2-Clause', 'CC-BY-SA-4.0']);
        const oeb = describeResource(getResourceDefinition('oeb'), 'v1');
        expect(oeb.license).toMatchObject({ spdx: 'CC0-1.0', name: 'Public domain (CC0)' });
    });

    it('the translation catalog record is the descriptor in reader-facing form', () => {
        for (const def of DATASETS.filter((d) => d.translation)) {
            const resource = getResourceDefinition(def.resource);
            expect(def.translation!.name).toBe(resource.title);
            expect(def.translation!.license).toBe(licenseInfo(resourceLicense(resource)).name);
            expect(def.translation!.description).toBe(resource.description);
        }
    });
});
