/**
 * Converts the SWORD "Nave" module (Nave's Topical Bible, public domain)
 * into the topics JSON the app seeds into Dexie (issue #28).
 *
 * The module is a zLD-compressed TEI lexicon. Layout, reverse-engineered
 * from the SWORD zstr format:
 *   - dict.zdx: per-block pairs of (offset: u32 LE, size: u32 LE) into dict.zdt
 *   - dict.zdt: zlib-deflated blocks
 *   - each decompressed block: entryCount u32, then entryCount pairs of
 *     (offset: u32, size: u32) relative to the block start, then the entries
 *   - each entry: <entryFree n="TOPIC">...TEI...</entryFree> where verse
 *     references are <ref osisRef="...">label</ref> and cross-topic pointers
 *     are <ref target="Nave:TOPIC">TOPIC</ref>
 *
 * Writes data/processed/naves-topics.json (array of topic records, ready
 * for copy-to-static's splitting).
 *
 * Run from packages/data-pipeline:
 *   pnpm run import:naves
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { dataDir } from './core/paths.js';

const dictDir = path.join(dataDir, 'texts', 'naves', 'modules', 'lexdict', 'zld', 'nave');
const outPath = path.join(dataDir, 'processed', 'naves-topics.json');

type TopicRef = { osis: string; label: string };
type TopicEntry = { label: string; refs: TopicRef[] };
type TopicSection = { heading: string; entries: TopicEntry[]; seeAlso: string[] };
export type TopicRecord = {
    id: string;
    name: string;
    sections: TopicSection[];
    refCount: number;
    seeAlso: string[];
};

// ─── zLD reading ──────────────────────────────────────────

function readEntries(): string[] {
    const zdx = fs.readFileSync(path.join(dictDir, 'dict.zdx'));
    const zdt = fs.readFileSync(path.join(dictDir, 'dict.zdt'));
    const entries: string[] = [];

    for (let b = 0; b * 8 + 8 <= zdx.length; b++) {
        const blockOffset = zdx.readUInt32LE(b * 8);
        const blockSize = zdx.readUInt32LE(b * 8 + 4);
        const block = zlib.inflateSync(zdt.subarray(blockOffset, blockOffset + blockSize));
        const count = block.readUInt32LE(0);
        for (let i = 0; i < count; i++) {
            const offset = block.readUInt32LE(4 + i * 8);
            const size = block.readUInt32LE(8 + i * 8);
            // Entries are NUL-padded; trim trailing terminator noise
            entries.push(block.subarray(offset, offset + size).toString('utf-8').replace(/\0+$/, ''));
        }
    }
    return entries;
}

// ─── TEI parsing ──────────────────────────────────────────

/** "ABEL-BETH-MAACHAH" → "Abel-Beth-Maachah"; keeps parenthetical casing simple. */
function displayName(key: string): string {
    return key.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

export function topicSlug(key: string): string {
    return key
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function stripTags(html: string): string {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s→·;,.-]+|[\s;,:·-]+$/g, '')
        .trim();
}

const ENTRY_RE = /<entryFree n="([^"]+)">([\s\S]*?)<\/entryFree>/;
const REF_RE = /<ref\s+(osisRef|target)="([^"]+)"[^>]*>([\s\S]*?)<\/ref>/g;
const ITEM_RE = /<item>([\s\S]*?)<\/item>/g;

/** Pull osisRef pills into `refs` and Nave: pointers into `pointers` from one chunk of TEI. */
function collectRefs(chunk: string, refs: TopicRef[], pointers: Set<string>): void {
    let refMatch: RegExpExecArray | null;
    REF_RE.lastIndex = 0;
    while ((refMatch = REF_RE.exec(chunk)) !== null) {
        const [, kind, value, label] = refMatch;
        if (kind === 'osisRef') {
            refs.push({ osis: value, label: stripTags(label) });
        } else if (value.startsWith('Nave:')) {
            pointers.add(topicSlug(value.slice('Nave:'.length)));
        }
    }
}

/**
 * Text before the first ref tag, cleaned of tag debris and a trailing
 * "See (also)"; taking only that also drops the punctuation left between
 * removed ref tags.
 */
function labelBefore(chunk: string): string {
    return stripTags(chunk.split(/<ref\s/)[0]).replace(/\s*\bsee( also)?$/i, '');
}

export function parseEntry(raw: string): TopicRecord | null {
    const match = ENTRY_RE.exec(raw);
    if (!match) return null;
    const [, key, body] = match;

    const sections: TopicSection[] = [];
    const seeAlso = new Set<string>();

    // <lb/> is the module's line/outline separator
    for (const segment of body.split(/<lb\s*\/>/)) {
        const entries: TopicEntry[] = [];
        const pointers = new Set<string>();

        // Text and refs outside any <list> belong to the section head
        // ("OF ENEMIES Ex 23:4; ..."); each <item> inside a list is a
        // labeled sub-entry ("Esau forgives Jacob Ge 33:4,11") or, when
        // it carries no scripture refs, a "See X" pointer.
        const head = segment.split(/<list\b/)[0];
        const headRefs: TopicRef[] = [];
        collectRefs(head, headRefs, pointers);
        if (headRefs.length > 0) entries.push({ label: '', refs: headRefs });

        let itemMatch: RegExpExecArray | null;
        ITEM_RE.lastIndex = 0;
        while ((itemMatch = ITEM_RE.exec(segment)) !== null) {
            const refs: TopicRef[] = [];
            collectRefs(itemMatch[1], refs, pointers);
            if (refs.length > 0) entries.push({ label: labelBefore(itemMatch[1]), refs });
        }

        const heading = labelBefore(head);
        for (const p of pointers) seeAlso.add(p);
        if (entries.length > 0 || heading) {
            sections.push({ heading, entries, seeAlso: [...pointers] });
        }
    }

    const refCount = sections.reduce(
        (sum, s) => sum + s.entries.reduce((n, e) => n + e.refs.length, 0),
        0
    );
    const slug = topicSlug(key);
    if (!slug) return null;
    return {
        id: slug,
        name: displayName(key),
        sections,
        refCount,
        seeAlso: [...seeAlso].filter((s) => s !== slug),
    };
}

// ─── Main ─────────────────────────────────────────────────

function main(): void {
    if (!fs.existsSync(path.join(dictDir, 'dict.zdt'))) {
        throw new Error('[import-naves] Module not found - run pnpm run fetch:naves first');
    }

    const raw = readEntries();
    const byId = new Map<string, TopicRecord>();
    for (const entry of raw) {
        const record = parseEntry(entry);
        if (!record) continue;
        // A handful of keys collapse to the same slug - keep the richer one
        const existing = byId.get(record.id);
        if (!existing || record.refCount > existing.refCount) byId.set(record.id, record);
    }

    const topics = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    const totalRefs = topics.reduce((sum, t) => sum + t.refCount, 0);
    const withRefs = topics.filter((t) => t.refCount > 0).length;

    // Sanity floor: the title page claims 20,000+ topics/subtopics and
    // 100,000 references; the digitized module carries ~5,300 top-level
    // topics. Anything far below that means the parse silently broke.
    if (topics.length < 4000 || totalRefs < 50000) {
        throw new Error(
            `[import-naves] Parse looks broken: ${topics.length} topics, ${totalRefs} refs ` +
            '(expected roughly 5,300 and 100,000+)'
        );
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(topics));
    const mb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
    console.log(
        `[import-naves] Wrote ${topics.length} topics (${withRefs} with refs, ` +
        `${totalRefs} scripture references) → naves-topics.json (${mb} MB)`
    );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) main();
