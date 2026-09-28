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
    'openbible/cross_references.txt': { sha256: 'd18f0cdee1fd9a0bb289e0c30154485857b396124f68fe0dcc37aaa5982644f8', accepted: '2026-09-22' },
    'naves/Nave.zip': { sha256: '52d9b7cde04c2abb5187ae804bcb97d93c7344a1358539f50ebc178ac0c945f0', accepted: '2026-07-26' },
    'catena/catenaaureacomme00thomuoft_djvu.xml': { sha256: '015ef5daf91bea8162e7e4365956f9f2d2642111f556ecd78d2285bdb0953b94', accepted: '2026-09-28' },
    'catena/a6788682p201thomuoft_djvu.xml': { sha256: '1420e50f98e396b352ca6039ee21a399debc60961de34b47d72876c9c7c4afc8', accepted: '2026-09-28' },
    'catena/catenaaureacomme01thomuoft_djvu.xml': { sha256: '58347c790bf6bc68db73086d6274712f0b2518a326d521f6ed30b6424a2dbd66', accepted: '2026-09-28' },
    'catena/catenaaureacomme02thomuoft_djvu.xml': { sha256: '4f2db6082d234847090a5fd81584df383a1da92eb69da63789c076811394222e', accepted: '2026-09-28' },
    'catena/a6788682p103thomuoft_djvu.xml': { sha256: '63bff18c6c13fb280660536f3a7d6417f9dc56a40e29b49c3c29d96d97b36159', accepted: '2026-09-28' },
    'catena/p2catenaaureacom03thomuoft_djvu.xml': { sha256: '184a3c048ba528b41e52dbf9610dc5d5f55b3391075b6ace94eaccffe60788cb', accepted: '2026-09-28' },
    'catena/catenaaureacomme04thomuoft_djvu.xml': { sha256: '93b7882f6814def3b40fbbd996d55943ef70c22d8a21570c15ff3cae36a97c8f', accepted: '2026-09-28' },
    'catena/a6788682p204thomuoft_djvu.xml': { sha256: '0c98920f8333a2bc664cf413d407938b0c7c0a059e9db59f0b7e19b238ac5c1c', accepted: '2026-09-28' },
};
