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

    it('builds provenance from the source registry: a pin for pinned hosts, the accepted checksum for the others, and each source\'s attribution', () => {
        const web = describeResource(getResourceDefinition('web'), 'v1');
        // The text is public domain, but the OSHB lemma data it ships with asks for credit, so the whole resource does
        expect(web.license).toEqual({ spdx: 'CC-BY-4.0', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' });
        expect(web.provenance.map((p) => p.sourceId)).toEqual(['web-text', 'oshb-morphhb', 'byzantine-majority-text']);
        expect(web.provenance[0]).toMatchObject({ license: 'public-domain', accepted: SOURCE_CHECKSUMS['eng-web.usfx.xml'].accepted, checksum: SOURCE_CHECKSUMS['eng-web.usfx.xml'].sha256 });
        expect(web.provenance[0].version).toBeUndefined();
        expect(web.provenance[0].attribution).toBeUndefined();
        expect(web.provenance[1]).toMatchObject({ license: 'CC-BY-4.0', version: SOURCES['oshb-morphhb'].version, attribution: SOURCES['oshb-morphhb'].attribution });
        expect(web.provenance[1].checksum).toBeUndefined();
        expect(web.version).toBe('v1');
    });

    // Permissive software licenses oblige redistributions to reproduce a notice rather than to credit
    const NOTICE_LICENSES = ['BSD-2-Clause', 'BSD-3-Clause', 'MIT', 'Apache-2.0'];
    const NO_OBLIGATIONS = ['public-domain', 'CC0-1.0'];

    it('every source whose license asks for credit carries its attribution wording, without restating the license', () => {
        for (const s of Object.values(SOURCES)) {
            if (NO_OBLIGATIONS.includes(s.license) || NOTICE_LICENSES.includes(s.license)) continue;
            expect(s.attribution, `${s.id} (${s.license}) has no attribution`).toBeTruthy();
            expect(s.attribution, `${s.id} attribution restates its license`).not.toMatch(/CC[ -]BY/);
        }
    });

    it('every source under a permissive software license carries the notice redistributions must reproduce', () => {
        for (const s of Object.values(SOURCES)) {
            if (!NOTICE_LICENSES.includes(s.license)) continue;
            expect(s.licenseNotice, `${s.id} (${s.license}) has no license notice`).toBeTruthy();
            // The BSD template opens with the copyright line; MIT and Apache notices vary, so their wording is checked per source
            if (s.license.startsWith('BSD-')) expect(s.licenseNotice, `${s.id} notice lacks a copyright line`).toMatch(/^Copyright \(c\) /);
        }
    });

    it('carries the OT-NT Reference Map BSD notice verbatim from the LICENSE at the pinned commit', () => {
        const notice = SOURCES['otnt-reference-map'].licenseNotice!;
        expect(notice.split('\n')[0]).toBe('Copyright (c) 2011, John D. Lewis');
        expect(notice).toContain('Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.');
        expect(notice).toContain('THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"');
        expect(notice.trimEnd()).toMatch(/EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE\.$/);
        const xrefs = describeResource(getResourceDefinition('cross-references'), 'v1');
        expect(xrefs.provenance.find((p) => p.sourceId === 'otnt-reference-map')?.licenseNotice).toBe(notice);
    });

    it('carries the wording an upstream prescribes verbatim', () => {
        // github.com/openscriptures/morphhb/blob/master/LICENSE.md: "You must attribute the work as follows"
        expect(SOURCES['oshb-morphhb'].attribution).toBe('Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb');
        // github.com/ubsicap/ubs-open-license README
        expect(SOURCES['ubs-parallel-passages'].attribution).toBe('UBS Parallel Passage Database, © 2023 United Bible Societies.');
    });

    it('refuses a resource that claims the public domain over a source that asks for credit', () => {
        const def = { ...getResourceDefinition('web'), license: undefined };
        expect(() => describeResource(def, 'v1')).toThrow(/claims public-domain but oshb-morphhb require attribution/);
        for (const r of RESOURCES) expect(() => describeResource(r, 'v1'), r.id).not.toThrow();
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
