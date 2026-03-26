# Open Data Sources — Assessment & Integration Plan

This document details the assessment of publicly available biblical datasets and maps how each dataset integrates into the Codex Scriptura roadmap, outlining the new features they unlock.

---

## Source Tier List

### S-Tier (Use immediately, high impact)

#### Theographic Bible Metadata
- **Repo:** `robertrouse/theographic-bible-metadata`
- **License:** CC BY-SA 4.0
- **What it is:** A knowledge graph of 3,000+ biblical people, 1,600+ places with GPS coordinates, 4,000+ events with dates, and verse-level linkages. Available as CSV, JSON, and Neo4j imports.
- **Data available:** `People.csv`, `Places.csv`, `Events.csv`, `Books.csv`, `Chapters.csv`, `Verses.csv`, `PeopleGroups.csv`, `Easton.csv` (Easton's Bible Dictionary), `WordIndex.csv`
- **Details:**
  - **People:** Hebrew/Greek names, bios, birth/death dates, family relationships, tribal affiliation, verse references.
  - **Places:** GPS lat/long, modern names, descriptions, verse references.
  - **Events:** Dates, duration, predecessor events, participants, locations, verse references.

**Roadmap Impact:**
- **Person Explorer (v0.3.0):** Click any name in the text to see biography, family tree, and all verse references.
- **Interactive Maps (v1.x Plugin):** Leverages GPS coordinates for 1,600+ locations.
- **Timeline Mode (v0.5.0):** Seed data for major biblical events mapped to dates.
- **Graph View enrichment (v0.3.0):** Add person→verse, place→verse, and event→verse edges alongside cross-references.
- **Semantic/Topical Search (v0.4.0):** "Verses set in Jerusalem" becomes a simple GPS-filtered lookup.
- **Book Metadata (v0.5.0):** Structured book-level data mapping to `BookMeta`.
- **Easton's Bible Dictionary (v0.3.0):** Full public domain dictionary for inline term definitions.

**New Feature Concept: "Who's Here?"**
When reading any chapter, show a sidebar widget listing every person, place, and event mentioned in the current passage, pulled zero-effort from Theographic for an enriched reading experience.

---

#### BradyStephenson/bible-data (Kaggle BibleData)
- **Repo:** `BradyStephenson/bible-data`
- **License:** Open (community-contributed)
- **What it is:** Deeply structured relational data about biblical persons, relationships, and linguistics.
- **Key datasets:**
  - `PersonLabel`, `PersonRelationship`, `PersonVerse`, `Place`, `Thing`, `HebrewStrongs`, `GreekStrongs`, `Commandment`

**Roadmap Impact:**
- **Family Tree Visualizer (v0.4.0):** Render interactive genealogy trees using `PersonRelationship` types.
- **Strong's Concordance (v0.4.0):** Full concordance as importable CSV data.
- **Object/Artifact Explorer (v0.5.0):** Covers notable biblical objects via the `Thing` dataset.
- **Commandment Index (Plugin):** Extracted lists of biblical commandments for ethical study.
- **Name Meaning Display (v0.3.0):** Hebrew/Greek etymology for every name via `PersonLabel`.

> **Merging Strategy:** Theographic and BibleData overlap on People and Places. We use Theographic as the primary source (cleaner schema) and supplement with BibleData's unique contributions: `PersonRelationship`, `Thing`, `Commandment`, and Strong's CSVs.

---

### A-Tier (Use in later milestones, significant value)

#### Freely-Given-org/OpenBibleData
- **Repo:** `Freely-Given-org/OpenBibleData`
- **What it is:** Curated collection of English Bible translations with datasets to make Bible data machine-processable. Useful when expanding the translation library.

#### mattrob33/christian-projects
- **Repo:** `mattrob33/christian-projects`
- **What it is:** A curated directory of open-source Christian developer projects. Strategic resource for plugin inspiration, feature gap analysis, and collaboration targets.

#### UCalgary Religious Studies Web Guide
- **URL:** `libguides.ucalgary.ca` Religious Studies guide
- **What it is:** Academic librarian curation of open-access resources for Christian/biblical studies. Sourcing for Church Fathers and dictionaries.

---

### B-Tier (Niche value, park for later)

#### religionhistory/SCCSR
- **What it is:** Cross-Cultural Sample of Religion (academic dataset documenting religious practices across 186 world cultures). Interesting for future "World Religions Context" plugins but too niche for early features.

---

## Recommended Import Priority

**Phase 1 (v0.3.0) — Core Enrichment:**
```
Theographic People.csv     → Person entity table in Dexie
Theographic Places.csv     → Place entity table in Dexie
Theographic Events.csv     → Event entity table in Dexie
Theographic Easton.csv     → Dictionary entry table in Dexie
```

**Phase 2 (v0.4.0) — Deep Study Support:**
```
BibleData PersonRelationship.csv → Relationship edges for genealogy
BibleData HebrewStrongs.csv      → Lexicon entries (Hebrew)
BibleData GreekStrongs.csv       → Lexicon entries (Greek)
```

**Phase 3 (v0.5.0+) — Advanced Enrichment:**
```
BibleData Thing.csv              → Biblical objects dataset
BibleData Commandment.csv        → Commandments index
Theographic Books.csv            → BookMeta enrichment
```

---

## Updated Data Model Additions

These new datasets require extending the central Dexie schema. The `verseRefs` arrays (multi-entry indexed with `*`) allow efficient querying ("which persons appear in Genesis 12?").

```typescript
// New tables structured for Dexie implementation:

// v0.3.0 Enrichment
persons: 'id, name, *verseRefs'
places: 'id, name, lat, lng, *verseRefs'
events: 'id, name, date, *verseRefs'
dictionary: 'id, term, definition'

// v0.4.0 Genealogy
relationships: 'id, personFrom, personTo, type'
```
