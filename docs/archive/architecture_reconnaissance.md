# Codex Scriptura: Architecture Reconnaissance & Execution Plan

## 1. Executive Summary

Codex Scriptura is currently a local-first Bible study app relying on bespoke pipeline scripts to ingest an ad-hoc collection of open datasets (Theographic, BibleData, OpenBible) directly into a Dexie IndexedDB. While this has allowed rapid development of core features (like the graph visualization and text reader), the project currently lacks a formalized data platform architecture. 

To evolve into a **multi-source, provenance-aware biblical data platform**, the codebase urgently needs a structural pivot. We must transition from point-to-point script integrations into a standardized ingestion pipeline with a canonical internal schema, robust provenance tracking, and explicit merge precedence rules. The goal is an agnostic core platform that maintains source isolation, resolves entities deterministically, and never blindly flattens contradictions.

## 2. Detailed Findings: Repository Reconnaissance

### Key Files & Directories
- **`packages/core/src/types.ts`**: The canonical data schema. Currently exhibits fragmented provenance tracking (e.g., ad-hoc `source?: 'theographic' | 'openbible'` on Places, `nameMeaningSource` on Persons) instead of a unified provenance interface.
- **`packages/db/src/index.ts`**: Dexie schema definition. Highly optimized for UI queries but lacks generic provenance or dataset metadata indexing.
- **`packages/data-pipeline/src/`**: Home of ETL scripts. This is currently a collection of bespoke utility scripts (`import-theographic.ts`, `enrich-places-openbible.ts`, `import-genealogy.ts`) without a shared adapter or ingestion framework.
- **`docs/architecture.md` / `docs/roadmap.md`**: Well-written implementation guides for the UI and UX features, but light on underlying data engineering principles.
- **`docs/open-data-sources.md`**: Currently lists some sources but does not reflect the comprehensive, prioritized dataset hierarchy required for the desired target architecture.

### Existing Architecture & Alignment
- **What belongs:** The separation of core graph primitives (`GraphNode`, `GraphEdge`) from the rendering layer is solid. The offline-first Dexie model and MiniSearch indexing are technically sound. `GraphEdgeCategory` begins to separate edge sources, but at too high a level.
- **What is missing:** A unified Source Registry. A formal entity resolution engine (currently just hardcoded checks in pipeline scripts). A conflict exception tracker (it currently overwrites or concatenates silently). License and redistributability metadata per record. A unified morphological pipeline to map varied original-language texts (OSHB, MorphGNT) into the core lexicons without coupling to one schema.

## 3. Document Audit

### Documents to Update
- **`docs/open-data-sources.md`**: Must be completely rewritten to establish the target roadmap defined in the mission: 
  - *Texts*: WEB, OEB, ULT/UST, SBLGNT, OSHB/UHB. (SWORD later).
  - *Morphology*: OSHB/UHB, MorphGNT -> Macula -> ETCBC/BHSA.
  - *Lexicons*: Strong's (primary key), Easton's (reader dictionary), STEPBible/OSHB (enrichment).
  - *Entities/Graph*: Theographic (backbone), OpenBible (primary cross-refs), BibleData (relational enrichment).
- **`docs/architecture.md`**: Needs a new section on "Data Platform Pipeline" describing the provenance model and source adapter interfaces.

### Documents to Add
- **`docs/data-platform.md`** (or `docs/provenance-and-resolution.md`): Should formalize merge precedence, entity ID stability, conflict resolution policies (e.g., handling conflicting lineage graphs), and how plugin data remains distinct from core platform data.

### Misleading / Outdated Documents
- The roadmap elements regarding `v0.5.0` morphology-aware search and `v0.4.0` Strong's import treat datasets as interchangeable CSV dumps rather than complex domains requiring source-adapters. The expectation of flat-merging BibleData with Theographic needs immediate architectural revision.

## 4. Data Architecture Gap Analysis

- **Source Registry**: Missing. The system does not formally register datasets (e.g. version, license, URL, ingestion date).
- **Provenance Model**: Missing. Records lack a `ProvenanceBlock` documenting which dataset(s) constructed them. `source` strings are haphazardly attached to only some entity models.
- **Conflict Model**: Missing. When OpenBible places overlap with Theographic places, the script handles it locally. In complex graphs (genealogies), contradictions are silently merged causing traversal loops or invalid assertions.
- **Entity Resolution**: Unstable. Relies on pipeline-script string matching. Needs a stable resolution map (e.g. local lookup configuration) mapping external identifiers to the canonical internal IDs.
- **Merge Precedence**: Implied by script runtime order. Must be explicitly prioritized (e.g. Theographic > BibleData > OpenBible).
- **Schema Gaps**: 
  - `Node` and `Edge` types require a `sourceDataset` identifier.
  - Cross-references need to isolate topical edges from direct textual linkages.
  - Missing a License/Redistributability flag on canonical records to avoid leaking restricted data.
- **ETL Gaps**: Missing abstract "Source Adapters". ETL requires a bridge pattern (Source Data -> Adapter -> Canonical Schema -> Merge Engine -> JSON Store).

## 5. Recommended Schema & Pipeline Priorities

1. **Implement `ProvenanceBundle` on Core Models**: Introduce a unified provenance interface (e.g., `interface PlatformRecord { sourceSystem: string, externalId: string, confidence?: number }`) to track the origin of every person, place, edge, and lexicon entry.
2. **Formalize Source Registry**: Create `packages/data-pipeline/src/registry/` defining the canonical datasets, their licenses, and adapter configurations.
3. **Stand up the Ingestion Engine**: Refactor existing `enrich-*` and `import-*` scripts to inherit from a base `SourceAdapter` class that forces output into the canonical schema and handles entity resolution deterministically without silent mutations.
4. **Isolate Graph Edges**: Add specific source qualifiers to `GraphEdge` and ensure that OpenBible cross-references and topical linkages do not bleed into the same untyped traversal paths.

## 6. Concrete Execution Plan for Claude Code

### Step 1: Scaffolding and Documentation
1. Create `docs/data-architecture.md` to define the ingestion pipeline, source adapters, provenance model, and merge precedence rules.
2. Rewrite `docs/open-data-sources.md` to match the exact source strategy (Texts, Morphology, Lexicons, Entities, Cross References) established in this blueprint.

### Step 2: Core Schema Update (Files: `packages/core/src/types.ts`)
1. Introduce an `EntityProvenance` type.
2. Refactor `Person`, `Place`, `BibleEvent`, `LexiconEntry`, and `CrossReference` to extend or include `EntityProvenance`.
3. Update `GraphEdge` to include `provenance` and strictly separate `topical` from `textual` cross-references.

### Step 3: Data Pipeline Refactoring (Files: `packages/data-pipeline/src/`)
1. Create a `packages/data-pipeline/src/core/` folder with:
   - `SourceRegistry.ts`: Defining all sources and licenses.
   - `EntityResolver.ts`: Managing external ID to canonical ID mappings.
   - `MergeEngine.ts`: Handling data conflicts according to configured precedence rules.
2. Refactor `packages/data-pipeline/src/importers/import-theographic.ts` to use the new `MergeEngine` and `SourceRegistry`.
3. Refactor `packages/data-pipeline/src/enrich-persons-bibledata.ts` to resolve against the formal `EntityResolver` and track conflicting lineage data rather than silently merging.

### Step 4: Database Layer Alignment (Files: `packages/db/src/index.ts`)
1. Modify `packages/db/src/index.ts` to gracefully handle the revised core types and ensure Dexie correctly indexes the updated `GraphEdge` types (especially the separation of topical vs cross-reference types).

## 7. Risks and Traps

- **Silently Merging Contradictions**: The biggest risk. If an Easton's dictionary entry contradicts a Theographic definition, or BibleData genealogies conflict (e.g. differing ancestries for Jesus), the merge engine must be configured to prioritize one and either drop or safely sideline the other, rather than merging them into a corrupted hybrid.
- **Overloading Dexie**: Dexie is great, but attempting to store every possible morphologically tagged text artifact and its full provenance chain locally could overwhelm browser storage. The pipeline must filter data down to exactly what the client app needs.
- **Licensing Assumptions**: Relying entirely on "Open Data" without tracking the specific CC or Public Domain status on a per-verse or per-entity basis could lock the platform out of App Stores/Hosting if a derived dataset inherits a restrictive license (e.g., SWORD modules).
- **Mixing Plugin Data with Core**: Plugin data (like a new commentary module) should not mutate the core foundational entity JSON assets. If an ETL pipeline script pulls commentary data, it belongs in a plugin-specific schema out-of-band of the native `PlatformRecord`.
- **Overengineering**: Focus heavily on the interfaces and the adapters first, rather than trying to import all datasets in Step 1. Get the architecture to ingest Theographic and BibleData correctly with provenance first.
