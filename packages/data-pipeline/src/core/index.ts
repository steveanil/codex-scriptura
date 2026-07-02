/**
 * Data pipeline core infrastructure.
 *
 * Provides source registry, entity resolution, merge engine, and conflict
 * tracking for the multi-source biblical data platform.
 *
 * See docs/data-architecture.md for the full architecture spec.
 */

export type {
    SourceDomain,
    SourceRef,
    ConflictClaim,
    ConflictRecord,
    SourceDataset,
    ImportRun,
    ResolutionMethod,
    ResolutionEntry,
    DomainMergeConfig,
} from './types.js';

export { SOURCES, getSource, getSourcesForDomain, getAllSourceIds } from './source-registry.js';
export { ResolutionMap, normalizeName } from './entity-resolver.js';
export { MergeEngine, DOMAIN_CONFIGS, type FieldMergeResult } from './merge-engine.js';
export { ConflictStore } from './conflict-store.js';
