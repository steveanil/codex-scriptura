/**
 * Accepted SHA-256 checksums for files fetched from UNPINNABLE hosts
 * (eBible.org, a.openbible.info - they serve only the latest build, so
 * commit pinning is impossible; issue #30). Fetch scripts refuse files
 * that do not match, making upstream changes a deliberate review step
 * instead of a silent update.
 *
 * GENERATED FILE - do not edit by hand. To accept a reviewed upstream
 * change: cd packages/data-pipeline && pnpm run checksums:update
 */

export type AcceptedChecksum = {
    /** Hex-encoded SHA-256 of the file contents. */
    sha256: string;
    /** Date (YYYY-MM-DD) the checksum was accepted after review. */
    accepted: string;
};

/** Keyed by path relative to data/texts/. */
export const SOURCE_CHECKSUMS: Record<string, AcceptedChecksum> = {
    'eng-web.usfx.xml': { sha256: '5ffa2626f170a109a4a96afc90775c06f0821cb4ba81ed34e63663e085708d68', accepted: '2026-07-22' },
    'eng-asv.usfx.xml': { sha256: '0fe2060c47a8a9616ad5c967ccfc807f5693451931c169dbaf648d0cf78b5502', accepted: '2026-07-22' },
    'eng-bsb.usfx.xml': { sha256: 'a381632316c3a5662fe883c28e80ac7cb4a7e54c35f3c9431471bc4ea320577f', accepted: '2026-07-22' },
    'eng-ylt.usfx.xml': { sha256: '27a56597ee47d17dd76b1797dd257de8840a0d39eb9143d2ca07f97b5e281db1', accepted: '2026-07-22' },
    'eng-dby.usfx.xml': { sha256: '9993edecce9b6a9d624235e2ae35510c1c5642b6a69035b75085986ba190a2f1', accepted: '2026-07-22' },
    'openbible/cross_references.txt': { sha256: 'a78e43feed83d26845847fa4182f84145a63a83f7be216011c668d581ed9ec56', accepted: '2026-07-22' },
};
