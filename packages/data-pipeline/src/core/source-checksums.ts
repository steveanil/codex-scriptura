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
    'eng-asv.usfx.xml': { sha256: '31ba1861a6a9de52b8a862d675e21e4ec4e7bc74a75c5e61ec62f95612645633', accepted: '2026-11-16' },
    'eng-bsb.usfx.xml': { sha256: 'f78ac41e8f20ec80ca78d8c56648faceb9572d6412ae49cef94b8d407983d117', accepted: '2026-11-16' },
    'eng-ylt.usfx.xml': { sha256: '27a56597ee47d17dd76b1797dd257de8840a0d39eb9143d2ca07f97b5e281db1', accepted: '2026-07-22' },
    'eng-dby.usfx.xml': { sha256: '9993edecce9b6a9d624235e2ae35510c1c5642b6a69035b75085986ba190a2f1', accepted: '2026-07-22' },
    'openbible/cross_references.txt': { sha256: 'd548f9ca1c66008f88bc3f175d1a403cd1c9b528fe8fe8460d0ef4592ba5e471', accepted: '2026-11-27' },
    'naves/Nave.zip': { sha256: '52d9b7cde04c2abb5187ae804bcb97d93c7344a1358539f50ebc178ac0c945f0', accepted: '2026-07-26' },
    'catena/catenaaureacomme00thomuoft_djvu.xml': { sha256: '015ef5daf91bea8162e7e4365956f9f2d2642111f556ecd78d2285bdb0953b94', accepted: '2026-09-28' },
    'catena/catenaaureacomme04thomuoft_djvu.xml': { sha256: '93b7882f6814def3b40fbbd996d55943ef70c22d8a21570c15ff3cae36a97c8f', accepted: '2026-09-28' },
};
