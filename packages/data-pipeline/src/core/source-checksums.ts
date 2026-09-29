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
    'catena/source/catenaaureacomme00thomuoft_jp2.zip': { sha256: '052322aee3b9b958aff08417f351c858d02b476318d6bf13cd54dc2bacff7732', accepted: '2026-09-29' },
    'catena/source/a6788682p201thomuoft_jp2.zip': { sha256: '54127af3bb362b84b8ec97d9113bb60435dc9089d73c68472f1c1c7589560659', accepted: '2026-09-28' },
    'catena/source/catenaaureacomme01thomuoft_jp2.zip': { sha256: 'e2919912ea5e394b57d4f743be43da1bdf2675a417b4b429f6db2c1e8334bfd3', accepted: '2026-09-29' },
    'catena/source/catenaaureacomme02thomuoft_jp2.zip': { sha256: 'c83770f7b1d853f50adecdf2588ca6381697c0ce14eae4a52ef25b455493509d', accepted: '2026-09-29' },
    'catena/source/a6788682p103thomuoft_jp2.zip': { sha256: 'b22130190fb0687c7836c3894e353b7197d2a0f41267425a5aa828ba8292d5fc', accepted: '2026-09-28' },
    'catena/source/p2catenaaureacom03thomuoft_jp2.zip': { sha256: 'ac9b0e7fafb76c724d84a954ca4a6b7b4c2d40511f0b85fe926c11a9cb048e83', accepted: '2026-09-28' },
    'catena/source/catenaaureacomme04thomuoft_jp2.zip': { sha256: 'a4eadc2725d1ff56cb108805863637ab3cf5cd4cfb250735c36961924f477535', accepted: '2026-09-29' },
    'catena/source/a6788682p204thomuoft_jp2.zip': { sha256: '0c95d0bb17806bfade6bc395c86714bcd629a76a7511745d3e559bcdd8f19c42', accepted: '2026-09-28' },
};
