# Open Data Sources — Assessment & Integration Plan

This document details the assessment of publicly available biblical datasets and maps how each dataset integrates into the Codex Scriptura roadmap, outlining the new features they unlock.

---

## Source Tier List

#### Theographic Bible Metadata
- **Repo:** `robertrouse/theographic-bible-metadata`
- **License:** CC BY-SA 4.0
- **What it is:** A knowledge graph of 3,000+ biblical people, 1,600+ places with GPS coordinates, 4,000+ events with dates, and verse-level linkages. Available as CSV, JSON, and Neo4j imports.
- **Data available:** `People.csv`, `Places.csv`, `Events.csv`, `Books.csv`, `Chapters.csv`, `Verses.csv`, `PeopleGroups.csv`, `Easton.csv`, `WordIndex.csv`
- **Confirmed Airtable Schema:**
  - **people:** `slug`, `alphaGroup`, `halfSiblingsSameFather` (pre-computed relationship, vital for Isaac vs Ishmael).
  - **places:** `slug`, `alphaGroup`.
  - **events:** `slug`, `verseCount`, `preceedingEvent` (typo in source, preserve as-is).
  - **periods:** `startYear`, `endYear`, `booksWritten`, `events` (handles year-format conversion e.g. "~2000 BC").
  - **easton:** Preserves foreign key references mapping directly to `places` and `people` tables, so clicking an Easton entry can show the GPS pin and verse list.
  - **verses:** `yearNum`, `mdText`, `maxYearLookup`, `minYearLookup` (feeds directly into v0.5.0 timeline dating).
  - **books/chapters:** `placeCount`, `peopleC`, `verseCount`, `writers`.
  - **peopleGroups:** `events`, `verses`, `memberOf`.

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

#### OpenBible Geocoding
- **Repo:** `github.com/openbibleinfo/Bible-Geocoding-Data`
- **License:** CC BY 4.0
- **What it is:** Provides GPS lat/lng, confidence level (certain/probable/possible/approximate/uncertain), sources per location, place photos (~1,000 Wikimedia links), and pre-built KML per book and chapter.
- **Details & Merge Strategy:**
  - The TSV has multiple rows per place (one per candidate location).
  - **Merge strategy:** GROUP BY `slug`, use highest-confidence candidate as primary lat/lng, store remaining candidates in a `place.candidates` JSON field.
  - **Join key:** Theographic `slug` ↔ OpenBible `slug`. Fallback: fuzzy match on normalized name (lowercase, strip punctuation). Flag unmatched for manual review.
  - **UX synergy:** `alphaGroup` on both datasets maps to a Dexie compound index for A–Z browsing in Person Explorer without full table scans.

**Roadmap Impact:**
- **Place confidence pins:** Surface the confidence field in the map UI (certain = solid pin, possible = dashed outline).
- **Inline place photos:** "Who's Here?" sidebar can show thumbnail from the `photoUrl` field (linking directly to Wikimedia).
- **Biblical timeline:** `events.yearNum` + `periods` table provides absolute and relative dates ready for the v0.5.0 timeline renderer.
- **Book-level KML overlays:** OpenBible's pre-built KML per book loaded by maps plugin as chapter-synced overlays.

---

#### BradyStephenson/bible-data (Kaggle BibleData)
- **Repo:** `BradyStephenson/bible-data`
- **License:** Open (community-contributed)
- **What it is:** Deeply structured relational data about biblical persons, relationships, and linguistics.
- **Key datasets:**
  - `PersonLabel`, `PersonRelationship`, `PersonVerse`, `Place`, `Thing`, `HebrewStrongs`, `GreekStrongs`, `Commandment`

**Roadmap Impact:**
- **Genealogy Viewer (v0.4.0):** Dual-mode interactive visualization using `PersonRelationship` typed edges — `d3.tree()` layout for explicit lineage passages (Matthew 1, Luke 3) and D3 force/graph layout for open person exploration. Entry points: "Who's Here?" panel, `EntityDetailPanel`, and the standalone `/study/person/:id` route.
- **Strong's Concordance (v0.4.0):** Full concordance as importable CSV data.
- **Object/Artifact Explorer (v0.5.0):** Covers notable biblical objects via the `Thing` dataset.
- **Commandment Index (Plugin):** Extracted lists of biblical commandments for ethical study.
- **Name Meaning Display (v0.3.0):** Hebrew/Greek etymology for every name via `PersonLabel`.

> **Merging Strategy:** Theographic and BibleData overlap on People and Places. We use Theographic as the primary source (cleaner schema) and supplement with BibleData's unique contributions: `PersonRelationship`, `Thing`, `Commandment`, and Strong's CSVs.

---

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

#### religionhistory/SCCSR
- **What it is:** Cross-Cultural Sample of Religion (academic dataset documenting religious practices across 186 world cultures). Interesting for future "World Religions Context" plugins but too niche for early features.

---

## Import Priority

**Phase 1 (v0.3.0) — Core Enrichment:**
```
import-theographic-people.ts (reads data/texts/theographic/People.csv) → data/processed/metadata/persons.json
import-theographic-places.ts (reads data/texts/theographic/Places.csv) → data/processed/metadata/places.json
import-theographic-events.ts (reads data/texts/theographic/Events.csv) → data/processed/metadata/events.json
import-theographic-easton.ts (reads data/texts/theographic/Easton.csv) → data/processed/metadata/dictionary.json
enrich-places-openbible.ts (reads data/texts/openbible/places.tsv)   → merges into data/processed/metadata/places.json
```

**Phase 2 (v0.4.0) — Deep Study Support:**
```
import-theographic-relationships.ts (reads data/texts/theographic/PersonRelationship.csv) → data/processed/relationships/genealogy.json
import-bibledata-hebrew-strongs.ts (reads data/texts/bibledata/HebrewStrongs.csv)       → data/processed/metadata/lexicon-hebrew.json
import-bibledata-greek-strongs.ts (reads data/texts/bibledata/GreekStrongs.csv)         → data/processed/metadata/lexicon-greek.json
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
persons:    'id, name, gender, alphaGroup, *verseRefs'
places:     'id, name, slug, lat, lng, confidence, alphaGroup, *verseRefs'
events:     'id, name, slug, yearNum, periodId, *verseRefs'
periods:    'id, name, startYear, endYear'
dictionary: 'id, term, slug, definition'

// v0.4.0 Genealogy
relationships: 'id, personFrom, personTo, type'
// type values: father-of | mother-of | spouse-of | sibling-of | half-sibling-same-father | ancestor-of
```
