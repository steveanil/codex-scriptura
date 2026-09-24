/**
 * Table definitions and every migration, in version order.
 *
 * Schema versions move only when the storage shape changes (a table, an
 * index, a settings-shape migration). Dataset re-seeding is the datasets
 * table's job (issue #310, decision D1), so versions 1 to 29's habit of
 * clearing a table to re-fire a count gate ends at v30.
 */

import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import type { VerseRecord, UserPreferences, HighlightPreset, InstalledDataset } from '@codex-scriptura/core';
import { LEGACY_DATASET_VERSION, translationDatasetId } from '@codex-scriptura/core';

export function defineSchema(db: Dexie): void {
    // v1: initial schema
    db.version(1).stores({
        verses: 'id, translationId, [translationId+book+chapter], [translationId+osisId], book, chapter',
        translations: 'id',
        annotations: 'id, type, verseStart, verseEnd, *tags, created, modified',
        tags: 'id, name',
        settings: 'id',
    });

    // v2: added 'book' index to annotations for cross-translation lookups
    db.version(2).stores({
        annotations: 'id, type, book, verseStart, verseEnd, *tags, created, modified',
    });

    // v3: added savedSearches table
    db.version(3).stores({
        savedSearches: 'id, created',
    });

    // v4: migrated UserSettings → UserPreferences (nested fonts, reader, presets)
    db.version(4).upgrade(async (tx) => {
        const old = await tx.table('settings').get('default');
        if (!old) return;
        const migrated: UserPreferences = {
            id: 'default',
            activeTranslation: old.activeTranslation ?? 'KJV',
            theme: old.theme ?? 'system',
            accentColor: '#6b5ce7',
            fonts: {
                ui: 'Inter',
                reader: 'Georgia',
                greek: 'SBL Greek',
                hebrew: 'SBL Hebrew',
                size: old.fontSize ?? 16,
            },
            reader: {
                lineHeight: 1.7,
                columnWidth: 'medium',
                density: 'normal',
                showVerseNumbers: true,
                showRedLetters: true,
                paragraphMode: false,
            },
            highlightPresets: [
                { id: 'yellow', name: 'Yellow', color: '#f59e0b' },
                { id: 'green',  name: 'Green',  color: '#22c55e' },
                { id: 'blue',   name: 'Blue',   color: '#3b82f6' },
                { id: 'pink',   name: 'Pink',   color: '#ec4899' },
            ],
        };
        await tx.table('settings').put(migrated);
    });

    // v5: Theographic entities - persons, places, events, dictionary
    db.version(5).stores({
        persons: 'id, name, *verseRefs',
        places: 'id, name, lat, lng, *verseRefs',
        events: 'id, name, *verseRefs',
        dictionary: 'id, term',
    });

    // v6: Update highlight preset colors for better contrast
    db.version(6).upgrade(async (tx) => {
        const settings = await tx.table('settings').get('default');
        if (settings && settings.highlightPresets) {
            const updated = settings.highlightPresets.map((p: HighlightPreset) => {
                if (p.id === 'yellow' && (p.color === '#fef08a' || p.color.startsWith('rgba'))) return { ...p, color: '#f59e0b' };
                if (p.id === 'green' && (p.color === '#bbf7d0' || p.color.startsWith('rgba'))) return { ...p, color: '#22c55e' };
                if (p.id === 'blue' && (p.color === '#bfdbfe' || p.color.startsWith('rgba'))) return { ...p, color: '#3b82f6' };
                if (p.id === 'pink' && (p.color === '#fbcfe8' || p.color.startsWith('rgba'))) return { ...p, color: '#ec4899' };
                return p;
            });
            await tx.table('settings').update('default', { highlightPresets: updated });
        }
    });

    // v7: Clear persons table to force re-seed with nameMeaning/nameMeaningSource fields
    // from the BibleData PersonLabel enrichment (v0.3.0).
    db.version(7).upgrade(async (tx) => {
        await tx.table('persons').clear();
    });

    // v8: Cached MiniSearch indexes - avoids rebuilding from scratch every session
    db.version(8).stores({
        searchIndexes: 'id, translationId',
    });

    // v9: Cross-references - ~340K verse-to-verse linkages from OpenBible/TSK
    db.version(9).stores({
        crossReferences: 'id, sourceVerse, targetVerse, type, [sourceVerse+type], [targetVerse+type]',
    });

    // v10: Genealogy relationships
    db.version(10).stores({
        relationships: 'id, personFrom, personTo, type, [personFrom+type], [personTo+type]',
    });

    // v11: Strong's lexicon - Hebrew entries from BibleData (Greek TBD)
    db.version(11).stores({
        lexicon: 'id, strongsNumber, language, lemma',
    });

    // v12: Clear relationships to force re-seed with deterministically mapped Theographic IDs
    db.version(12).upgrade(async (tx) => {
        await tx.table('relationships').clear();
    });

    // v13: Clear cross-references to re-seed with corrected quotation classifications
    //       (overlay type-priority fix: OT-NT-Reference-Map quotation no longer
    //        shadowed by UBS allusion on the same verse pair)
    db.version(13).upgrade(async (tx) => {
        await tx.table('crossReferences').clear();
    });

    // v14: Cool-slate design refresh - move users still on the old default
    // accent/fonts to the new defaults. Deliberate customizations (values
    // that differ from the old defaults) are left untouched.
    db.version(14).upgrade(async (tx) => {
        const prefs = await tx.table('settings').get('default');
        if (!prefs) return;
        const patch: Record<string, unknown> = {};
        if (prefs.accentColor === '#6b5ce7' || prefs.accentColor === '#8b7cf6') {
            patch.accentColor = '#5e9ed6';
        }
        const fonts = { ...prefs.fonts };
        let fontsChanged = false;
        if (fonts.ui === 'Inter') { fonts.ui = 'Instrument Sans'; fontsChanged = true; }
        if (fonts.reader === 'Georgia' || fonts.reader === 'Crimson Pro') {
            fonts.reader = 'Newsreader';
            fontsChanged = true;
        }
        if (fontsChanged) patch.fonts = fonts;
        if (Object.keys(patch).length > 0) {
            await tx.table('settings').update('default', patch);
        }
    });

    // v15: The cool-slate design is dark-first - users still on the old
    // 'system' default follow the app default; an explicit 'light' stays.
    db.version(15).upgrade(async (tx) => {
        const prefs = await tx.table('settings').get('default');
        if (prefs?.theme === 'system') {
            await tx.table('settings').update('default', { theme: 'dark' });
        }
    });

    // v16: Clear verses to re-seed with corrected text extraction -
    // translator footnote/cross-ref note content no longer leaks into
    // verse text (WEB <f>/<x>, OEB <note>), and bridged verses
    // (<v id="15-16"/>) are now imported instead of dropped. Cached
    // search indexes are cleared because they index the old text.
    db.version(16).upgrade(async (tx) => {
        await tx.table('verses').clear();
        await tx.table('searchIndexes').clear();
    });

    // v17: God is not part of the family tree. Theographic encodes
    // Luke 3:38 ("Adam, which was the son of God") as literal family
    // columns, giving god_1324 father-of edges to Adam and Eve - which
    // put God at the apex of every ancestry walk. The importer now
    // excludes these; this removes them from already-seeded databases.
    db.version(17).upgrade(async (tx) => {
        await tx.table('relationships').where('personFrom').equals('god_1324').delete();
        await tx.table('relationships').where('personTo').equals('god_1324').delete();
    });

    // v18: generic kv table for app state that isn't UserPreferences
    // (known-issues #15). navHistory previously lived as a stray record
    // in the typed settings table via `as any` - delete it there (it is
    // ephemeral by design: cleared on tab close, so nothing to migrate).
    // The split-pane layout migrates from localStorage lazily on first
    // restore (stores/splitPanes.svelte.ts).
    db.version(18).stores({
        kv: 'id',
    }).upgrade(async (tx) => {
        await tx.table('settings').delete('navHistory');
    });

    // v19: Re-seed Theographic entities so places pick up geocoding
    // confidence from the corroboration pass (issue #124). Clearing
    // persons is what actually triggers the re-seed - the seed gate
    // (isTheographicSeeded) checks persons.count(); the seeder then
    // repopulates persons, places, events, and dictionary together.
    db.version(19).upgrade(async (tx) => {
        await tx.table('places').clear();
        await tx.table('persons').clear();
    });

    // v20: Clear lexicon to re-seed with the pronunciation field
    // (issue #26). isLexiconSeeded checks lexicon.count(), so
    // clearing the table triggers the re-seed.
    db.version(20).upgrade(async (tx) => {
        await tx.table('lexicon').clear();
    });

    // v21: Delete KJV verses to re-seed from the CrossWire OSIS source,
    // which carries word-level Strong's tagging (issue #25). Cached
    // search indexes are cleared too - the Strong's index must include
    // the newly tagged KJV.
    db.version(21).upgrade(async (tx) => {
        await tx.table('verses').where('translationId').equals('KJV').delete();
        await tx.table('searchIndexes').clear();
    });

    // v22: Delete all tagged translations' verses to re-seed with
    // word-aligned Strong's spans (VerseRecord.align, issue #27) - the
    // basis for lemma-grouped Word Study results. Cached search indexes
    // are cleared because they store snapshots of the old records.
    db.version(22).upgrade(async (tx) => {
        await tx.table('verses').where('translationId').anyOf('KJV', 'ASV', 'BSB', 'DBY').delete();
        await tx.table('searchIndexes').clear();
    });

    // v23: Delete WEB verses to re-seed with derived Strong's tokens
    // (issue #134) - verse-level lemmas derived from OSHB morphhb (OT)
    // and the Robinson-Pierpont Byzantine text (NT). Cached search
    // indexes are cleared so the Strong's index includes the tagged WEB.
    db.version(23).upgrade(async (tx) => {
        await tx.table('verses').where('translationId').equals('WEB').delete();
        await tx.table('searchIndexes').clear();
    });

    // v24: Topical index (Nave's Topical Bible, issue #28)
    db.version(24).stores({
        topics: 'id, name',
    });

    // v25: Delete all USFX-imported translations' verses to re-seed
    // with punctuation intact (issue #175) - the importer used to turn
    // <add>/<wj>/<bd> wrapper tags into spaces, detaching punctuation
    // in ~950 verses ("said she , God"). Cached search indexes are
    // cleared because they snapshot the corrupted text (exact-phrase
    // search across the bad boundaries never matched).
    db.version(25).upgrade(async (tx) => {
        await tx.table('verses').where('translationId').anyOf('WEB', 'ASV', 'BSB', 'YLT', 'DBY').delete();
        await tx.table('searchIndexes').clear();
    });

    // v26: Drop indexes nothing queries (issue #173) - verses' plain
    // book/chapter (all reads go through translationId or the compound
    // indexes) and crossReferences' type/[sourceVerse+type]/
    // [targetVerse+type]. Five b-trees maintained across ~217K verse
    // and 341K cross-ref writes for zero benefit; Dexie rebuilds the
    // tables' indexes on re-declaration, no data migration needed.
    db.version(26).stores({
        verses: 'id, translationId, [translationId+book+chapter], [translationId+osisId]',
        crossReferences: 'id, sourceVerse, targetVerse',
    });

    // v27: The WEB Strong's derivation leaked Psalm-superscription
    // lemmas (Nathan, Bathsheba, Saul, David) into Ps 51/52/54/60 v1
    // (issue #176) - delete WEB verses to re-seed with the corrected
    // derivation. Cached search indexes snapshot lemmas, so they are
    // cleared too.
    db.version(27).upgrade(async (tx) => {
        await tx.table('verses').where('translationId').equals('WEB').delete();
        await tx.table('searchIndexes').clear();
    });

    // v28: Delete KJV verses to re-seed with two issue #177 pipeline
    // fixes (which also made AddEsth/4Macc reachable via core BOOKS):
    // Greek Esther's 12 "…" placeholder verses are now dropped at
    // import, and 7 Sirach verses the importer used to skip entirely
    // (container-style <verse> markup: 1:7, 6:2, 22:21, 25:13, 28:1,
    // 31:31, 40:8) are recovered. Search indexes snapshot the verse
    // set, so they are cleared too.
    db.version(28).upgrade(async (tx) => {
        await tx.table('verses').where('translationId').equals('KJV').delete();
        await tx.table('searchIndexes').clear();
    });

    // v29: Cross-references are now one record per verse pair, oriented
    // later verse -> earlier verse, with mirror rows merged (issue
    // #183). The old directional ids never match the new ones, so the
    // table is cleared and re-seeded from the merged dataset.
    db.version(29).upgrade(async (tx) => {
        await tx.table('crossReferences').clear();
    });

    // v30: Dataset identity moves out of the schema version (issue
    // #310, decision D1). One `datasets` row per installed dataset,
    // backfilled as "legacy" so each reconciles against the deploy
    // manifest exactly once. From here on the schema version moves
    // only when the storage shape changes; a corrected dataset ships
    // as a new manifest version and replaces itself on the next boot.
    db.version(30).stores({
        datasets: 'id',
    }).upgrade((tx) => backfillLegacyDatasets(tx));

    // v31: Precomputed aggregates (issue #38) - the book matrix and the
    // per-verse degrees the pipeline derives from cross-references, stored
    // whole under their manifest id. A shape change, so a schema bump; the
    // rows themselves arrive through dataset reconciliation like any other.
    db.version(31).stores({
        aggregates: 'id',
    });

    // v32: Strong's postings (issue #166) - per tagged translation, the
    // verses carrying each Strong's id, so a Strong's search reads only
    // its hits. Rows arrive as a dataset derived from the translation and
    // leave with it.
    db.version(32).stores({
        strongsPostings: '[translationId+strongsId], translationId',
    });

    // v33: Resource descriptors (issue #51, decision D2) - one row per
    // resource the deploy catalogues (a translation, the entity graph, a
    // lexicon...), holding its license, provenance and version. Synced
    // from the manifest on every boot; which of them are installed is
    // answered by the `datasets` receipts that name them.
    db.version(33).stores({
        resources: 'id, type',
    });
}

/** Datasets that own a whole table, by manifest id. */
const WHOLE_TABLE_DATASETS: Array<[id: string, table: string]> = [
    ['persons', 'persons'],
    ['places', 'places'],
    ['events', 'events'],
    ['dictionary', 'dictionary'],
    ['cross-references', 'crossReferences'],
    ['genealogy', 'relationships'],
    ['naves-topics', 'topics'],
];

/**
 * v30 upgrade: one legacy row per dataset the profile already holds.
 * Every legacy row mismatches the manifest on the next boot and is
 * replaced exactly once; after that no legacy row remains. Nothing else is
 * touched: user tables are not read, and no dataset rows are cleared here.
 */
export async function backfillLegacyDatasets(tx: Transaction): Promise<void> {
    const installedAt = Date.now();
    const rows: InstalledDataset[] = [];
    const legacy = (id: string, recordCount: number) => {
        if (recordCount > 0) rows.push({ id, version: LEGACY_DATASET_VERSION, contentHash: null, installedAt, recordCount });
    };

    const verses = tx.table('verses');
    for (const key of await verses.orderBy('translationId').uniqueKeys()) {
        const translationId = String(key);
        legacy(translationDatasetId(translationId), await verses.where('translationId').equals(translationId).count());
    }

    for (const [id, table] of WHOLE_TABLE_DATASETS) {
        legacy(id, await tx.table(table).count());
    }

    for (const language of ['hebrew', 'greek']) {
        legacy(`lexicon-${language}`, await tx.table('lexicon').where('language').equals(language).count());
    }

    await tx.table('datasets').bulkPut(rows);
}
