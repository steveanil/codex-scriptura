# Open Data Sources - Assessment & Integration Plan

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

#### Translation Library Expansion (planned - v0.5.0)

[eBible.org](https://ebible.org) distributes hundreds of translations in USFX/USFM - the same
format our existing WEB importer already parses, so each addition is a manifest entry plus a
pipeline run, not a new importer. Priority candidates, all free to redistribute:

| Translation | License | Why |
|---|---|---|
| **ASV** (American Standard Version, 1901) | Public domain | The scholar's classic literal translation |
| **BSB** (Berean Standard Bible) | Public domain (2023 dedication) | Modern, readable, fully public domain - rare combination |
| **YLT** (Young's Literal Translation) | Public domain | Hyper-literal; valued for word studies |
| **Darby** (1890) | Public domain | Literal alternative |
| **DRA** (Douay-Rheims, American 1899) | Public domain | Catholic canon incl. deuterocanon - pairs with the planned canon-comparison features |
| **Geneva Bible** (1599) | Public domain | Historical interest; Reformation-era study notes tradition |
| **WEBBE / WMB** (WEB British / Messianic eds.) | Public domain | Low-cost variants of an existing import |
| **unfoldingWord ULT/UST** | CC BY-SA 4.0 | Already scheduled; translation-pair for meaning vs. form |
| Non-English starters: **RVA 1909** (Spanish), **Luther 1912** (German), **Louis Segond 1910** (French) | Public domain | Internationalization beachhead |

*Licenses to review before use:* LSV (Literal Standard Version - verify current CC terms),
NET Bible (free-of-charge but **not** open license - likely excluded).

**Architecture prerequisite:** `seedAll()` currently seeds every manifest up front. Before the
library grows past ~4 translations, seeding must become **on-demand per translation** with a
"Translation Manager" panel in Settings (download / remove / storage size per translation).
(Book/chapter lists were already moved off full verse scans to index-only key scans -
known-issues.md #12, fixed 2026-07-15; storing the lists on the `Translation` record at seed
time remains a further option as the library grows.)

#### Strong's-Tagged Sources (unblocks v0.4.0 Strong's search)

The v0.4.0 blocker - "no `<w lemma>` markup in current sources" - is solvable today:

| Source | License | What it gives |
|---|---|---|
| **STEPBible-Data TAHOT + TAGNT** (`STEPBible/STEPBible-Data`) | CC BY 4.0 | Word-level Hebrew (OT) and Greek (NT) with Strong's numbers, aligned to KJV versification - the cleanest path to `VerseRecord.lemmas` |
| **CrossWire KJV OSIS module** | Text public domain; tagging freely redistributed | Full KJV with `<w lemma="strong:H…">` markup - flows through the existing `extractLemmas()` pipeline unchanged |
| **OSHB/morphhb** (OpenScriptures Hebrew Bible) | CC BY 4.0 | Morphologically tagged Hebrew (also feeds v0.5.0 morphology search) |
| **MorphGNT / SBLGNT** | CC BY-SA 3.0 / SBLGNT license | Tagged Greek NT (v0.5.0 morphology) |

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
  - **people:** `slug`, `alphaGroup`, `halfSiblingsSameFather`, and the family columns (`father`, `mother`, `partners`, `children`, `siblings`) - since 2026-07 the **primary genealogy source**, because every value is a personLookup ID in the app's own ID space (no name matching).
  - **places:** `slug`, `alphaGroup`.
  - **events:** `slug`, `verseCount`.
  - **periods:** Timeline mapping data.
  - **verses:** Used via `mdText`, `maxYearLookup`, `minYearLookup`.
- **Roadmap Impact:** Seed data for "Who's Here?", entity timelines, map integrations, and the genealogy viewer's core edge set.

#### BradyStephenson/bible-data (Relational Enrichment)
- **Repo:** `BradyStephenson/bible-data` (Open/community)
- **Role:** Deeply structured relational augmentation over the backbone. 
- **Provides:** 
  - `PersonRelationship`, `PersonLabel`, `PersonVerse`, `Thing`, `HebrewStrongs`, `GreekStrongs`.
- **Roadmap Impact:** Name meanings (`PersonLabel`), Hebrew Strong's lexicon, the future object explorer, and a genealogy *supplement* (`ancestor-of`, `half-sibling-same-father` edges - Theographic family columns are the primary genealogy source since the 2026-07 importer rewrite; see [data-architecture.md](data-architecture.md#32-relationships--genealogy)).

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

### 5. Scholar Sources - Manuscripts, Church Fathers, Commentaries (v0.5.0–v0.7.0)

These power the scholar-facing milestones (Manuscript Explorer, Church Fathers Library,
Commentary Framework, Apostolic Succession Tracker - see roadmap).

#### Manuscripts & Critical Texts
| Source | License | Role |
|---|---|---|
| **CNTR** - Center for New Testament Restoration (`greekcntr.org`) | CC BY 4.0 | Transcriptions of the earliest NT manuscripts **with dates and metadata** - the backbone dataset for the Manuscript Explorer (witnesses per book, dating, provenance) |
| **Westminster Leningrad Codex** (via OSHB) | Public domain / CC BY 4.0 | The MT witness for the OT |
| **Swete's LXX** (1930) | Public domain | Septuagint text for MT-vs-LXX comparison (Rahlfs is copyrighted - avoid) |
| **Nestle 1904 GNT** | Public domain | Public-domain critical Greek NT for TR-vs-critical-text comparison |
| **Codex Sinaiticus Project** | Transcription terms vary - review | Reference/linkout target rather than bundled data |
| **INTF/NTVMR** (Münster) | Mixed - review per dataset | Manuscript catalog metadata (GA numbers, dates, locations) for linkouts |

#### Church Fathers
| Source | License | Role |
|---|---|---|
| **CCEL - ANF & NPNF series** (Ante-Nicene Fathers, 10 vols; Nicene & Post-Nicene, 28 vols) | Public domain (Schaff translations); available as ThML/XML | The Church Fathers Library corpus. Each work carries **author, date range, and region** metadata. The printed volumes include *scripture indexes* - parseable into `father-quote → verse` edges that plug straight into the existing typed cross-reference graph |
| **Eusebius, *Ecclesiastical History*** (NPNF II.1) | Public domain | Primary source for the Apostolic Succession Tracker seed data (bishop lists of Rome, Antioch, Alexandria, Jerusalem) |

#### Commentaries (public domain)
Matthew Henry (v1.1.0 first dataset, already planned), then: Jamieson-Fausset-Brown, Barnes'
Notes, Adam Clarke, John Gill, Calvin's Commentaries, Keil & Delitzsch. All public domain; all
verse-keyed, which maps directly onto the planned commentary plugin schema (verse-keyed content).

### 6. Directories, Academic & Future Plugin Inspiration

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

**Phase 1 (v0.3.0) - Core Enrichment (complete):**
```
import-theographic.ts        (reads data/texts/theographic/*.csv)      → persons.json, places.json, events.json, dictionary.json
enrich-places-openbible.ts   (reads data/texts/openbible/places TSV)   → merges GPS data into places.json
enrich-persons-bibledata.ts  (reads data/texts/bibledata/PersonLabel)  → merges name meanings into persons.json
```

**Phase 2 (v0.4.0) - Deep Study Support (complete):**
```
import-cross-references.ts   (reads openbible/cross_references.txt + typed overlays) → cross-references.json
import-genealogy.ts          (reads theographic/People.csv family cols + bibledata/PersonRelationship.csv supplement) → genealogy.json
import-lexicon.ts            (reads bibledata/HebrewStrongs.csv + openscriptures/strongs-greek-dictionary.js)
                                                                       → lexicon-hebrew.json, lexicon-greek.json
```

All of the above run via `pnpm setup:data` from the repo root - see [Local Development](local-development.md).

### Accuracy & Reproducibility Hardening (planned)

Because the app merges many open datasets, textual accuracy depends on pipeline discipline, not
just source quality:

1. **Pin source versions.** Fetch scripts should record the upstream commit SHA / release tag and
   a SHA-256 checksum of each downloaded file into the source registry (`version` field exists,
   unused). A changed checksum on re-fetch is a report, never a silent update.
2. **Validation stage** *(shipped 2026-07-15; hardened 2026-07-18)*: `validate-texts.ts` runs at
   the end of `import:all` - canonical chapter counts, bridge-aware verse-gap analysis against
   per-translation source-verified omission lists, Apocrypha numbering variants, and a
   trailing-verse check against `kjv-versification.ts` (a checked-in per-chapter verse-count
   table generated from the raw KJV source by `pnpm run generate:versification`); report written
   to `data/processed/_metadata/text-validation.json`, hard errors fail the pipeline.
3. **Golden-sample tests** *(shipped 2026-07-15)*: exact-text vitest assertions for anchor
   verses per translation + a leaked-footnote-phrase sweep (`golden-texts.test.ts`); they run
   wherever pipeline data exists and skip cleanly in CI.
4. **Import-run ledger.** `import-runs.json` (already being adopted) gives every processed file a
   traceable origin: source, inputs, counts, timestamp.

**Phase 3 (v0.5.0+) - Advanced Enrichment:**
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
