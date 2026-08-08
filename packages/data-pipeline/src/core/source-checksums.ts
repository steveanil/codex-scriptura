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
    'eng-asv.usfx.xml': { sha256: '136d9cc4eb3043285bb90c079a9a70e4e75efb52b091a7c4f38b2d38787eed7a', accepted: '2026-08-08' },
    'eng-bsb.usfx.xml': { sha256: '3356ac05074fbcab09409190c612b4d36abc31498e286f10e83256f5f3d3bbf1', accepted: '2026-08-08' },
    'eng-ylt.usfx.xml': { sha256: '27a56597ee47d17dd76b1797dd257de8840a0d39eb9143d2ca07f97b5e281db1', accepted: '2026-07-22' },
    'eng-dby.usfx.xml': { sha256: '9993edecce9b6a9d624235e2ae35510c1c5642b6a69035b75085986ba190a2f1', accepted: '2026-07-22' },
    'openbible/cross_references.txt': { sha256: '89489e5fdfbca6bab43c77b8fe1d971ec35ed64ffda34eecc544a6f3160774dd', accepted: '2026-08-08' },
    'naves/Nave.zip': { sha256: '52d9b7cde04c2abb5187ae804bcb97d93c7344a1358539f50ebc178ac0c945f0', accepted: '2026-07-26' },
};
