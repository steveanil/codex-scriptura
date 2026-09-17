/**
 * Dataset identity shared by the pipeline, the db package and seeding
 * (issues #310/#311). A dataset is identified by its manifest id plus the
 * version and content hash the deploy carries.
 */

/** Version marker for rows backfilled by the v30 migration; never matches a manifest. */
export const LEGACY_DATASET_VERSION = 'legacy';

/** Manifest id of a translation's verse dataset, e.g. "translation:kjv" for KJV. */
export function translationDatasetId(translationId: string): string {
    return `translation:${translationId.toLowerCase()}`;
}
