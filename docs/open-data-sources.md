# Open Data Sources — Assessment & Integration Plan

This document details the assessment of publicly available biblical datasets and maps how each dataset integrates into the Codex Scriptura roadmap, outlining the new features they unlock. 

> **Data platform reference:** All datasets listed here are formally registered in the
> [Source Registry](../packages/data-pipeline/src/core/source-registry.ts). For merge
> precedence rules, provenance tracking, and conflict resolution policies, see
> [Data Platform Architecture](data-architecture.md).

---

## Targeted Interconnectivity Strategy

We arrange Biblical resources by domain integration, mapping their role inside the native application architecture.

### 1. Texts
- **KJV, WEB, OEB:** Currently implemented plain-text Bible imports.
- **ULT/UST, SBLGNT, OSHB/UHB:** Scheduled additions.
- **SWORD Modules:** Later iteration support for standard text distribution.

### 2. Morphology
- **Current state:** Untagged.
- **Future sources:** `OSHB` / `UHB`, `MorphGNT` -> `Macula` -> `ETCBC/BHSA`.
- **Purpose:** Will map original-language tags onto translation verses via `VerseRecord.lemmas`.

### 3. Lexicons
- **Strong's:** Primary key for the lexicon structure. Hebrew imported from BibleData (`HebrewStrongs.csv`); Greek imported from the OpenScriptures Strong's dictionary (`openscriptures/strongs`, CC BY-SA 3.0).
- **Easton's Bible Dictionary:** Used as the reader-level dictionary lookup. Sourced via Theographic.
- **STEPBible / OSHB:** Future planned enrichment for extended glosses and morphological data.

### 4. Entities & Graph

#### Theographic Bible Metadata (Backbone)
- **Repo:** `robertrouse/theographic-bible-metadata` (CC BY-SA 4.0)
- **Role:** Primary foundation for person explorer, maps, and events.
- **Provides:**
  - **people:** `slug`, `alphaGroup`, `halfSiblingsSameFather`.
  - **places:** `slug`, `alphaGroup`.
  - **events:** `slug`, `verseCount`.
  - **periods:** Timeline mapping data.
  - **verses:** Used via `mdText`, `maxYearLookup`, `minYearLookup`.
- **Roadmap Impact:** Seed data for "Who's Here?", entity timelines, and map integrations.

#### BradyStephenson/bible-data (Relational Enrichment)
- **Repo:** `BradyStephenson/bible-data` (Open/community)
- **Role:** Deeply structured relational augmentation over the backbone. 
- **Provides:** 
  - `PersonRelationship`, `PersonLabel`, `PersonVerse`, `Thing`, `HebrewStrongs`, `GreekStrongs`.
- **Roadmap Impact:** Primary driver of the interactive Genealogy viewer, Strong's concordance integration, and object explorer.

#### OpenBible (Primary Cross-References)
- **Repo:** `github.com/openbibleinfo/Bible-Geocoding-Data` / `Cross-References` (CC BY 4.0)
- **Role:** Secondary enrichment and primary cross-referencing.
- **Provides:** GPS lat/lng mappings, confidence levels for location coordinates, and ~340K verse-to-verse linkages.
- **Roadmap Impact:** Feeds Scripture Graph and provides geographic confidence tiers for map view.

#### Typed Cross-Reference Overlays (Edge Classification)
- **Repos:** `balinjdl/OT-NT-Reference-Map` and `ubsicap/ubs-open-license` (UBS Parallel Passages)
- **Role:** Classify the OpenBible/TSK cross-reference edges into typed relationships.
- **Provides:**
  - **OT-NT-Reference-Map:** Chapter-level OT↔NT links typed as quotation (`q`), allusion (`a`), or possible allusion (`p`).
  - **UBS Parallel Passages:** Verse-level passage groups; cross-testament groups are typed as `allusion`, same-testament as `parallel`.
- **Roadmap Impact:** Powers the "Why is this quoted?" badges and typed edge filtering in the Scripture Graph. See `packages/data-pipeline/src/importers/parse-typed-overlays.ts`.

### 5. Directories, Academic & Future Plugin Inspiration

#### Freely-Given-org/OpenBibleData
- **Repo:** `Freely-Given-org/OpenBibleData`
- **What it is:** Curated collection of English Bible translations with datasets to make Bible data machine-processable. Useful when expanding the translation library.

#### mattrob33/christian-projects
- **Repo:** `mattrob33/christian-projects`
- **What it is:** A curated directory of open-source Christian developer projects. Strategic resource for plugin inspiration, feature gap analysis, and collaboration targets.

#### UCalgary Religious Studies Web Guide
- **URL:** `libguides.ucalgary.ca` Religious Studies guide
- **What it is:** Academic librarian curation of open-access resources for Christian/biblical studies. Sourcing for Church Fathers and dictionaries.

#### religionhistory/SCCSR
- **What it is:** Cross-Cultural Sample of Religion (academic dataset documenting religious practices across 186 world cultures). Interesting for future "World Religions Context" plugins but too niche for early features.

---

## Import Priority Pipeline

**Phase 1 (v0.3.0) — Core Enrichment (complete):**
```
import-theographic.ts        (reads data/texts/theographic/*.csv)      → persons.json, places.json, events.json, dictionary.json
enrich-places-openbible.ts   (reads data/texts/openbible/places TSV)   → merges GPS data into places.json
enrich-persons-bibledata.ts  (reads data/texts/bibledata/PersonLabel)  → merges name meanings into persons.json
```

**Phase 2 (v0.4.0) — Deep Study Support (complete):**
```
import-cross-references.ts   (reads openbible/cross_references.txt + typed overlays) → cross-references.json
import-genealogy.ts          (reads bibledata/PersonRelationship.csv)  → genealogy.json
import-lexicon.ts            (reads bibledata/HebrewStrongs.csv + openscriptures/strongs-greek-dictionary.js)
                                                                       → lexicon-hebrew.json, lexicon-greek.json
```

All of the above run via `pnpm setup:data` from the repo root — see [Local Development](local-development.md).

**Phase 3 (v0.5.0+) — Advanced Enrichment:**
```
BibleData Thing.csv              → Biblical objects dataset
BibleData Commandment.csv        → Commandments index
Theographic Books.csv            → BookMeta enrichment
```

---

## Data Model Additions (shipped)

These datasets extended the central Dexie schema as follows. The `verseRefs` arrays (multi-entry indexed with `*`) allow efficient querying ("which persons appear in Genesis 12?").

```typescript
// v0.3.0 Enrichment (Dexie v5)
persons:    'id, name, *verseRefs'
places:     'id, name, lat, lng, *verseRefs'
events:     'id, name, *verseRefs'
dictionary: 'id, term'

// v0.4.0 Genealogy, Cross-References & Lexicon (Dexie v9–v11)
crossReferences: 'id, sourceVerse, targetVerse, type, [sourceVerse+type], [targetVerse+type]'
relationships:   'id, personFrom, personTo, type, [personFrom+type], [personTo+type]'
lexicon:         'id, strongsNumber, language, lemma'
```

See [architecture.md](architecture.md#database-schema-dexie) for the authoritative, versioned schema.
