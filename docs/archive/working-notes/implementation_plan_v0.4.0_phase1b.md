# Phase 1B: Relationships Import (Genealogy Data)

This implementation plan details the delivery of Phase 1B of the Genealogy Engine in Codex Scriptura. It will introduce the required structured semantic relationships without touching UI layouts or generic graph abstractions per the requirements.

## Proposed Changes

### 1. Shared Types (Core)

#### [MODIFY] `packages/core/src/types.ts`
Add the strict enumeration for relationship edge typing that the Phase 3 genealogy subgraph engine requires. We will append this to the type definitions:
```typescript
export type RelationshipType =
  | 'father-of'
  | 'mother-of'
  | 'spouse-of'
  | 'sibling-of'
  | 'half-sibling-same-father'
  | 'ancestor-of';

export type Relationship = {
  id: string;
  personFrom: string;
  personTo: string;
  type: RelationshipType;
};
```

### 2. Database Model (Dexie)

#### [MODIFY] `packages/db/src/index.ts`
Add the `relationships` table correctly indexed for reverse lookups.
1. Bump the Dexie version to 10.
2. Define the schema in `stores`:
   `relationships: 'id, personFrom, personTo, type, [personFrom+type], [personTo+type]'`
3. Add the `Relationship` type model to the `CodexDB` Dexie extension interface.
4. Implement one query helper method as requested:
   ```typescript
   export async function getRelationshipsForPerson(personId: string): Promise<Relationship[]>
   ```
   (This executes two queries: where `personFrom == personId` OR `personTo == personId` and merges them.)
5. Add a helper `isRelationshipsSeeded(): Promise<boolean>`.

### 3. Importer Pipeline (Data Pipeline)

#### [NEW] `packages/data-pipeline/src/importers/import-genealogy.ts`
Implement the core CSV parser.
- Reads `data/texts/bibledata/BibleData-Relationship.csv` or handles missing gracefully with a descriptive warning (unfaked completion).
- The mapping maps raw labels strictly to the 6 expected types. E.g., maps `father` -> `father-of`, `spouse` -> `spouse-of`, discarding unmapped ones or logging a clear summary.
- Implements string ID deduplication based on sorted inputs if bidirectional.

#### [NEW] `packages/data-pipeline/src/import-genealogy.ts`
The executable entrypoint for `tsx`.

#### [MODIFY] `packages/data-pipeline/package.json`
Add the scripts:
- `"import:genealogy": "tsx src/import-genealogy.ts"`
- Append it to `"setup:theographic"` or a new command.

#### [MODIFY] `packages/data-pipeline/src/copy-to-static.ts`
Append `'genealogy.json'` to the `FILES` array so the data is properly hoisted to the static web directory.

### 4. Seed Pipeline

#### [MODIFY] `src/lib/seed.ts`
Append the seed routing:
1. Create `seedRelationships()` that fetches `/data/genealogy.json`.
2. Wrap insertion in bulk Dexie transaction to prevent locks.
3. Append `await seedRelationships()` to the `seedAll()` routine.

## Open Questions

> [!CAUTION]
> The exact raw CSV target for relationships wasn't detected using standard `find` in the `data/` directory (it is absent locally). The `import-genealogy.ts` logic will assume a two column `Source,Target,Type` model for mapping. If the raw CSV target has a specific file-name (`People_Relationships.csv` vs `BibleData-Relationship.csv`) that should be checked in the importer, please confirm the expected path, though I will wire it to fallback gracefully if the path is missing.

## Verification Plan

### Automated Checks
- `cd packages/data-pipeline && pnpm run import:genealogy` (verifies safe failure or execution on missing file)
- `cd packages/data-pipeline && pnpm run copy` (verifies genealogy.json mapping)
- `pnpm exec tsc --noEmit` locally.

### Spot Check Queries
Run a console check in Chrome DevTools to assert insertion:
```javascript
const db = window.codex.db; // assuming dev exposure, or check indexed db raw
await db.relationships.count();
```
