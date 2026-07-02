# Data Platform Architecture

> **Status:** Proposed (v0.5.0 target). This document defines the target architecture for
> Codex Scriptura's multi-source biblical data platform. It is the authoritative reference
> for provenance tracking, entity resolution, conflict handling, and merge rules.
>
> **What is implemented vs proposed:**
> - Source Registry types and pipeline scaffolding: **scaffolded** (types + empty runtime)
> - Provenance types on core models: **scaffolded** (types defined, not yet populated by importers)
> - Conflict / competing claims model: **proposed** (types defined, storage TBD)
> - Entity resolution map: **proposed** (types defined, population deferred)
> - Domain-specific merge rules: **documented** (this file), not yet enforced in code
> - Existing importers continue to work unchanged; migration is incremental

---

## 1. Design Principles

1. **Source isolation.** Every fact in the system traces back to a specific dataset, import run, and external identifier. No record should exist without knowing where it came from.

2. **Domain-specific precedence.** There is no single global "this dataset wins" rule. Each domain (persons, places, cross-references, lexicon, text) has its own precedence chain because different datasets are authoritative for different things.

3. **Field-level provenance.** A Person record might have its `name` from Theographic and its `nameMeaning` from BibleData. Provenance must track which source contributed each field, not just which source "owns" the record.

4. **Competing claims over silent merges.** When two sources disagree on a factual claim (e.g., conflicting genealogies), both claims are stored with their sources. The UI picks a display default based on precedence, but the alternative is preserved and surfaceable. Never silently flatten contradictions.

5. **Asserted vs. derived facts.** An asserted fact comes directly from a source dataset ("David is the father of Solomon" — BibleData). A derived fact is computed by our pipeline ("David appears in 1 Sam 16" — synthesized from verse-text entity matching). The system must distinguish these because derived facts can be recomputed; asserted facts cannot.

6. **Incremental adoption.** Existing importers and the Dexie client schema work today. The provenance model is additive — new fields on existing types, new tables alongside existing ones. No big-bang migration.

7. **Client-side budget.** Dexie/IndexedDB runs in the browser. The provenance metadata stored client-side must be the minimum needed for display ("sourced from Theographic") and conflict surfacing ("2 sources disagree on this field"). Full import-run audit logs and raw source records live in the build-time pipeline only, never shipped to the client.

---

## 2. Source Registry

Every dataset integrated into Codex Scriptura is registered with metadata that enables license compliance, reproducibility, and provenance tracking.

### 2.1 Registry Schema

```typescript
type SourceDataset = {
    /** Machine identifier, e.g. 'theographic', 'openbible-geo', 'bibledata' */
    id: string;
    /** Human-readable name */
    name: string;
    /** SPDX license identifier or 'public-domain' */
    license: string;
    /** Whether derived data may be redistributed in app bundles */
    redistributable: boolean;
    /** Canonical URL (repo or download) */
    url: string;
    /** Domains this source is authoritative for */
    domains: SourceDomain[];
    /** Precedence tier within each domain (lower = higher priority) */
    precedence: Partial<Record<SourceDomain, number>>;
    /** Version or commit hash of the dataset as imported */
    version?: string;
};
```

### 2.2 Registered Sources (current)

| ID | Name | License | Domains | Notes |
|---|---|---|---|---|
| `theographic` | Theographic Bible Metadata | CC BY-SA 4.0 | persons, places, events, dictionary | Backbone for entity data |
| `openbible-geo` | OpenBible Geocoding | CC BY 4.0 | places | GPS coordinates, confidence levels |
| `openbible-xref` | OpenBible Cross-References | CC BY 4.0 | cross-references | ~340K verse-to-verse links (TSK-derived) |
| `bibledata` | BibleData (Kaggle) | Open/community | persons, relationships, lexicon | Relationships, Hebrew Strong's, name meanings |
| `openscriptures-strongs` | OpenScriptures Strong's Greek Dictionary | CC BY-SA 3.0 | lexicon | Greek Strong's entries* |
| `otnt-refmap` | OT-NT-Reference-Map | Open/community | cross-references | Typed OT↔NT links (quotation/allusion) overlay* |
| `ubs-parallel` | UBS Parallel Passages | UBS open license | cross-references | Parallel/allusion typing overlay* |
| `kjv-text` | King James Version | Public domain | text | Plain-text, no morphological tagging |
| `web-text` | World English Bible | Public domain | text | USFX source with `<wj>` markup |
| `oeb-text` | Open English Bible | CC BY 4.0 | text | Plain-text |

\* Integrated in the pipeline (v0.4.0) but not yet added to `source-registry.ts` — pending Phase B adoption.

### 2.3 Planned Sources (not yet integrated)

| ID | Name | License | Domains | Blocked on |
|---|---|---|---|---|
| `oshb` | OpenScriptures Hebrew Bible | CC BY 4.0 | morphology, text | Importer not built |
| `morphgnt` | MorphGNT | CC BY-SA 3.0 | morphology, text | Importer not built |
| `sblgnt` | SBL Greek NT | SBLGNT license | text | License review needed |
| `stepbible-lexicon` | STEPBible Lexicon | CC BY 4.0 | lexicon | Importer not built |

---

## 3. Domain-Specific Merge Precedence

Each data domain has its own precedence rules. "Precedence" means: when displaying a single value for a field, use the highest-precedence source. Lower-precedence values are preserved as competing claims, not discarded.

### 3.1 Persons / Places / Events (Entity backbone)

| Priority | Source | Role |
|---|---|---|
| 1 | Theographic | Primary — provides IDs, names, verse references, GPS coords for places |
| 2 | BibleData | Enrichment — name meanings (`PersonLabel`), additional verse links |
| 3 | OpenBible Geocoding | Enrichment — higher-confidence GPS coordinates for places |

**Field-level rules:**
- `id`: Always Theographic ID (canonical anchor)
- `name`: Theographic (display name)
- `verseRefs`: Union of all sources (additive, no conflict possible)
- `lat`/`lng` (places): Prefer OpenBible when confidence > Theographic; store both with source tags
- `nameMeaning` (persons): BibleData is the only source; no conflict
- `description`: Theographic primary; BibleData enrichment stored separately if different

### 3.2 Relationships / Genealogy

| Priority | Source | Role |
|---|---|---|
| 1 | BibleData `PersonRelationship` | Primary — typed edges (father-of, mother-of, spouse-of, etc.) |
| 2 | Theographic `halfSiblingsSameFather` | Supplementary — specific relationship subtype |

**Conflict policy:** Genealogical relationships are the most contradiction-prone domain in biblical data. When two sources assert conflicting parentage (e.g., differing ancestries in Matthew 1 vs. Luke 3), **both claims are stored** with their source attribution. The UI displays the higher-precedence source's claim by default but surfaces a "competing claims" indicator.

### 3.3 Cross-References

| Priority | Source | Role |
|---|---|---|
| 1 | OpenBible/TSK | Primary — verse-to-verse links with community vote weights |
| 2 | OT-NT-Reference-Map / UBS Parallel Passages | Type classification overlay — assigns `quotation`/`allusion`/`parallel` types to edges (verse-pair keys take precedence over chapter-pair keys; see `parse-typed-overlays.ts`) |
| 3 | (future) STEPBible | Enrichment — additional typed cross-references |

**Edge type isolation:** Cross-reference edges are stored with their `CrossReferenceType`. Topical/thematic links (`theme`, `keyword`) must remain distinct from textual links (`quotation`, `allusion`, `parallel`) in both storage and query. The current schema already enforces this via the `type` field.

### 3.4 Lexicon / Strong's

| Priority | Source | Role |
|---|---|---|
| 1 | Strong's numbers | Primary key — the universal identifier for original-language words |
| 2 | BibleData `HebrewStrongs` | Primary Hebrew data — definitions, transliterations |
| 3 | OpenScriptures Strong's dictionary | Primary Greek data — lemmas, transliterations, definitions |
| 4 | (future) STEPBible / OSHB enrichment | Extended glosses, morphological data |

**Merge rule:** Lexicon entries are keyed by Strong's number. Hebrew and Greek come from different sources and never overlap. If two sources ever provide the same field (e.g., `gloss`), prefer the language's primary source, store the alternative.

### 3.5 Translation Texts

**Texts are never merged across datasets.** Each translation is a self-contained, immutable dataset identified by its `translationId`. There is no precedence — they coexist. A verse in KJV and a verse in WEB are separate records, never blended.

The only cross-text operation is Strong's number assignment (`VerseRecord.lemmas`), which maps original-language tags from a morphologically tagged source onto a translation's verses. This is a join, not a merge.

---

## 4. Provenance Model

### 4.1 Build-Time Provenance (Pipeline)

Every import run is logged with metadata sufficient to reproduce the import:

```typescript
type ImportRun = {
    /** UUID for this import execution */
    id: string;
    /** Source dataset ID from the registry */
    sourceId: string;
    /** ISO 8601 timestamp */
    timestamp: string;
    /** Git commit hash of the data-pipeline code */
    pipelineVersion: string;
    /** Source file paths or URLs consumed */
    inputFiles: string[];
    /** Record counts: created, updated, skipped, conflicted */
    stats: {
        created: number;
        updated: number;
        skipped: number;
        conflicts: number;
    };
};
```

Import runs are written to `data/processed/_metadata/import-runs.json` during pipeline execution. They are **not** shipped to the client — they exist for auditability and reproducibility only.

### 4.2 Client-Side Provenance (Dexie)

Client-side provenance must be lightweight. Every entity record carries a `SourceRef[]` array indicating which sources contributed to it:

```typescript
type SourceRef = {
    /** Source dataset ID from the registry */
    sourceId: string;
    /** The record's identifier in the source dataset (for traceability) */
    externalId?: string;
    /** Which fields this source contributed */
    fields: string[];
};
```

This is attached to entity types as an optional field during the migration period:

```typescript
type Person = {
    // ... existing fields ...
    /** Provenance: which sources contributed to this record's fields */
    sources?: SourceRef[];
};
```

**Why `SourceRef[]` and not a single `source` string:**
The current `Place.source` field (`'theographic' | 'openbible' | 'merged'`) conflates "who contributed" with "was there a merge." A record enriched by two sources needs both attributed — the `'merged'` value loses information about which source provided which field.

### 4.3 Fact Classification

Every provenance-tracked datum is implicitly one of:

| Class | Definition | Example | Recomputable? |
|---|---|---|---|
| **Asserted** | Directly stated in a source dataset | "Moses is male" (Theographic) | No — delete source, lose fact |
| **Derived** | Computed by pipeline logic from source data | "Moses appears in Exod.2.1" (from verse-text matching) | Yes — re-run pipeline |
| **Competing** | Two+ sources assert conflicting values for the same field | Theographic says X coords, OpenBible says Y coords | No — both preserved |

The `SourceRef.fields` array distinguishes asserted from derived: if a field is listed in a `SourceRef`, the source asserted it. If a field exists on the record but no `SourceRef` claims it, it was derived.

---

## 5. Conflict and Competing Claims

### 5.1 When Conflicts Arise

A conflict exists when two sources provide different values for the same field on the same resolved entity. Examples:
- Theographic and OpenBible provide different GPS coordinates for the same place
- Two genealogy sources disagree on parentage
- Two lexicon sources provide different glosses for the same Strong's number

### 5.2 Conflict Storage

Conflicts are stored in a sidecar structure, not inline on the entity record. The entity record carries the **winning** value (determined by domain-specific precedence). The competing value is stored in a `ConflictRecord`:

```typescript
type ConflictRecord = {
    /** Deterministic ID: `${entityType}:${entityId}:${field}` */
    id: string;
    /** Entity type: 'person', 'place', 'event', 'relationship', 'lexicon' */
    entityType: string;
    /** Entity ID (canonical internal ID) */
    entityId: string;
    /** Field name where the conflict exists */
    field: string;
    /** The claims from each source, ordered by precedence (winner first) */
    claims: ConflictClaim[];
};

type ConflictClaim = {
    sourceId: string;
    value: unknown;
    /** Optional note explaining the claim (e.g., "Matthew 1 lineage" vs "Luke 3 lineage") */
    note?: string;
};
```

**Client-side storage:** Conflicts that matter for UI display (e.g., competing genealogies) are shipped as a `conflicts.json` static asset alongside entity data. The Dexie schema gains a `conflicts` table in a future version. Conflicts that are purely pipeline-internal (e.g., coordinate precision differences below display threshold) are logged but not shipped.

### 5.3 UI Surfacing

When an entity has conflicts:
- The `EntityDetailPanel` shows a small indicator (e.g., a footnote icon) next to conflicted fields
- Clicking the indicator expands to show the competing claims with their sources
- The user sees: "According to Theographic: X. According to OpenBible: Y."
- No opinion is expressed about which is "correct" — precedence determines the default display, but both are visible

---

## 6. Entity Resolution

### 6.1 The Problem

The same real-world entity (e.g., "Jerusalem") appears in multiple datasets under different identifiers:
- Theographic: `jerusalem_1`
- OpenBible: `Jerusalem`
- BibleData: `Jerusalem_1`

Entity resolution is the process of establishing that these refer to the same entity and mapping them to a single canonical ID.

### 6.2 Resolution Map

The resolution map is a static lookup table maintained in the pipeline:

```typescript
type ResolutionEntry = {
    /** Canonical internal ID (always the Theographic ID when available) */
    canonicalId: string;
    /** Entity type */
    entityType: 'person' | 'place' | 'event' | 'lexicon';
    /** Map of source dataset ID → external ID in that dataset */
    externalIds: Record<string, string>;
    /** How this mapping was established */
    method: 'exact-name' | 'normalized-name' | 'manual' | 'id-pattern';
    /** Confidence: 1.0 = certain, 0.8 = high, 0.5 = probable, <0.5 = uncertain */
    confidence: number;
};
```

**Resolution methods (in order of preference):**

1. **ID pattern match** (`confidence: 1.0`): BibleData uses `Moses_1` which directly maps to Theographic `Moses_1`. Deterministic, zero ambiguity.
2. **Exact name match** (`confidence: 0.95`): Normalized names match exactly and there is only one candidate in each dataset.
3. **Normalized name match** (`confidence: 0.8`): Names match after stripping punctuation, case-folding, and suffix removal. Single candidate required.
4. **Manual mapping** (`confidence: 1.0`): Human-curated for known edge cases (e.g., "Abram" ↔ "Abraham" when ID patterns don't align).

**Ambiguity handling:** When multiple candidates match (e.g., multiple people named "Judas"), the resolver skips the match entirely rather than guessing. Unresolved entities are logged and flagged for manual review.

### 6.3 Confidence Model

The `confidence` field on `ResolutionEntry` expresses how certain we are that two external records refer to the same real-world entity. It is **not** a data quality score — a low-confidence resolution means "we're not sure these are the same entity," not "this entity's data is bad."

Confidence thresholds:
- `>= 0.8`: Auto-merge. The winning source's fields are written to the canonical record; the losing source's fields are stored as enrichment or competing claims.
- `0.5 – 0.79`: Tentative merge. Fields are merged but a `ConflictRecord` is generated for review.
- `< 0.5`: No merge. The entity from the secondary source is stored as a separate record with a `tentativeMatch` pointer to the candidate canonical ID.

---

## 7. Pipeline Architecture

### 7.1 Current State

The pipeline is a collection of standalone scripts in `packages/data-pipeline/src/`:
- `import-theographic.ts` — reads Theographic CSVs, writes `persons.json`, `places.json`, `events.json`, `dictionary.json`
- `enrich-places-openbible.ts` — joins OpenBible GPS data into `places.json`
- `enrich-persons-bibledata.ts` — joins BibleData name meanings into `persons.json`
- `importers/import-cross-references.ts` — reads OpenBible TSV, writes `cross-references.json`
- `importers/import-genealogy.ts` — reads BibleData CSV, writes `relationships.json`
- `importers/import-hebrew-strongs.ts` — BibleData Strong's CSV → `lexicon-hebrew.json`
- `importers/import-greek-strongs.ts` — OpenScriptures Strong's dictionary JS → `lexicon-greek.json`
- `importers/parse-typed-overlays.ts` — OT-NT-Reference-Map + UBS overlays → typed edge lookup for the cross-reference importer

These scripts work and produce correct output. They will **not** be rewritten wholesale. The target architecture wraps them with shared infrastructure incrementally.

### 7.2 Target State

```
packages/data-pipeline/src/
  core/                          ← NEW: shared pipeline infrastructure
    source-registry.ts           — dataset definitions and license metadata
    entity-resolver.ts           — resolution map management
    merge-engine.ts              — domain-aware field-level merge with conflict detection
    conflict-store.ts            — conflict record accumulation and serialization
    types.ts                     — pipeline-specific types (ImportRun, etc.)
  importers/                     ← EXISTING: individual dataset importers
    import-theographic.ts        — (unchanged initially, later adopts registry)
    import-cross-references.ts   — (unchanged initially)
    import-genealogy.ts          — (unchanged initially)
    import-hebrew-strongs.ts     — (unchanged initially)
    import-greek-strongs.ts      — (unchanged initially)
    import-osis.ts               — (unchanged)
    import-usfx.ts               — (unchanged)
    parse-typed-overlays.ts      — (unchanged)
  enrich-persons-bibledata.ts    — (unchanged initially, later uses resolver)
  enrich-places-openbible.ts     — (unchanged initially, later uses merge engine)
  ...existing scripts...
```

### 7.3 Migration Path

**Phase A (this commit): Scaffolding.**
- Define all types in `packages/data-pipeline/src/core/types.ts`
- Create `source-registry.ts` with the dataset catalog (static data, no runtime logic yet)
- Create `entity-resolver.ts` with the `ResolutionMap` class (load/save/query interface, initially empty)
- Create `merge-engine.ts` with the `MergeEngine` class (domain precedence config, merge method signature)
- Create `conflict-store.ts` with the `ConflictStore` class (accumulate and serialize conflicts)

**Phase B (future): Adoption.**
- Migrate `enrich-persons-bibledata.ts` to use `EntityResolver` for matching (replaces ad-hoc `normalizeName`)
- Migrate `enrich-places-openbible.ts` to use `MergeEngine` for GPS coordinate merging (replaces ad-hoc `source: 'merged'`)
- Add `SourceRef[]` to pipeline JSON output
- Generate `conflicts.json` during enrichment passes

**Phase C (future): Client integration.**
- Add `conflicts` Dexie table
- Surface competing claims in `EntityDetailPanel`
- Migrate `Place.source` field to `Place.sources: SourceRef[]`

---

## 8. Schema Summary

### 8.1 New Types (packages/core/src/types.ts)

```typescript
// ─── Source & Provenance ─────────────────────────────────

type SourceDomain =
    | 'persons' | 'places' | 'events' | 'dictionary'
    | 'relationships' | 'cross-references'
    | 'lexicon' | 'morphology' | 'text';

type SourceRef = {
    sourceId: string;
    externalId?: string;
    fields: string[];
};

// ─── Conflict Model ──────────────────────────────────────

type ConflictClaim = {
    sourceId: string;
    value: unknown;
    note?: string;
};

type ConflictRecord = {
    id: string;
    entityType: string;
    entityId: string;
    field: string;
    claims: ConflictClaim[];
};
```

### 8.2 New Types (packages/data-pipeline/src/core/types.ts)

```typescript
// ─── Source Registry ─────────────────────────────────────

type SourceDataset = {
    id: string;
    name: string;
    license: string;
    redistributable: boolean;
    url: string;
    domains: SourceDomain[];
    precedence: Partial<Record<SourceDomain, number>>;
    version?: string;
};

// ─── Import Tracking ─────────────────────────────────────

type ImportRun = {
    id: string;
    sourceId: string;
    timestamp: string;
    pipelineVersion: string;
    inputFiles: string[];
    stats: { created: number; updated: number; skipped: number; conflicts: number };
};

// ─── Entity Resolution ──────────────────────────────────

type ResolutionMethod = 'exact-name' | 'normalized-name' | 'manual' | 'id-pattern';

type ResolutionEntry = {
    canonicalId: string;
    entityType: 'person' | 'place' | 'event' | 'lexicon';
    externalIds: Record<string, string>;
    method: ResolutionMethod;
    confidence: number;
};
```

### 8.3 Existing Type Migrations (additive, non-breaking)

| Type | New field | Purpose |
|---|---|---|
| `Person` | `sources?: SourceRef[]` | Field-level provenance |
| `Place` | `sources?: SourceRef[]` | Replaces ad-hoc `source` field (backward-compatible) |
| `BibleEvent` | `sources?: SourceRef[]` | Field-level provenance |
| `CrossReference` | `sources?: SourceRef[]` | Track which xref dataset provided this edge |
| `LexiconEntry` | `sources?: SourceRef[]` | Track BibleData vs future STEPBible |
| `Relationship` | `sources?: SourceRef[]` | Track which genealogy source asserted this edge |

The existing `Place.source` and `Person.nameMeaningSource` fields remain for backward compatibility during migration. New code should read from `sources[]`; old code continues to work.

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provenance metadata bloats client-side JSON | Slower seed, more IndexedDB storage | Ship only `SourceRef[]` (minimal); keep `ImportRun` build-side only |
| Resolution map grows unmanageable | Manual review backlog | Auto-resolve at confidence >= 0.8; only flag ambiguous cases |
| Conflict UI adds complexity before it adds value | Users confused by "competing claims" on every entity | Only surface conflicts in domains where they matter (genealogy, coordinates); hide trivial conflicts |
| Existing importers break during migration | Data pipeline regression | Phase B adoption is opt-in per importer; existing scripts unchanged until explicitly migrated |
| Overengineering before real multi-source needs arise | Wasted effort on unused abstractions | Phase A is types + empty scaffolding only; no runtime logic until Phase B importers need it |

---

## 10. Relationship to Other Documents

- **[architecture.md](architecture.md):** Application architecture (stack, UI, Dexie schema, search). This document extends it with data platform concerns. `architecture.md` will reference this document for provenance and merge details.
- **[open-data-sources.md](open-data-sources.md):** Dataset catalog and import priority. This document formalizes the merge rules that `open-data-sources.md` describes informally.
- **[roadmap.md](roadmap.md):** Feature milestones. The data platform work targets v0.5.0 adoption, with scaffolding landing earlier.
- **[archive/architecture_reconnaissance.md](archive/architecture_reconnaissance.md):** The initial audit that motivated this document (now archived — superseded by this file). Some recommendations from the reconnaissance were refined here, notably: domain-specific precedence replaces global precedence, and field-level provenance replaces record-level.
