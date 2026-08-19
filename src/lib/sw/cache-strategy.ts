// Decision logic for the service worker's fetch handler, kept pure so it can
// be unit tested - the worker module itself imports the virtual
// `$service-worker` module and only runs inside a worker scope.

export type RequestPlan = 'precached-asset' | 'navigation' | 'passthrough';

/**
 * Whether a static-file path is seed data (`/data/*.json`), which the
 * service worker must NOT precache or serve (issue #163):
 *
 * - The ~148MB payload is consumed exactly once by first-boot seeding and
 *   then lives in IndexedDB - caching it stores all scripture twice.
 * - The install cache is keyed by deploy version, so every deploy
 *   re-downloaded the full payload even when the data was unchanged.
 * - `cache.addAll` is atomic: one flaky fetch out of ~24 large files
 *   failed the whole install.
 * - A re-seed (Dexie bump after a pipeline fix) exists precisely because
 *   the data changed - serving a cached copy would silently re-seed
 *   stale data.
 *
 * Excluded paths fall through planRequest as 'passthrough': straight to
 * the network, never cached. An offline re-seed simply degrades to the
 * seeding error banner and retries on the next online boot.
 */
export function isSeedDataPath(pathname: string): boolean {
    return pathname.startsWith('/data/');
}

/**
 * Classify a same-origin GET request.
 *
 * - `precached-asset`: the pathname is in this deployment's asset manifest
 *   (build files, static files, prerendered pages) - serve cache-first.
 * - `navigation`: a page navigation to a non-asset URL - serve network-first
 *   with the offline SPA-shell fallback.
 * - `passthrough`: anything else, notably an outdated page requesting a
 *   previous deployment's hashed chunks. These must never touch the cache:
 *   the host answers dead asset paths with the SPA fallback page
 *   (200 text/html), and caching that under a script URL wedges the app in
 *   a reload loop until a hard refresh (issue #145).
 */
export function planRequest(
    pathname: string,
    mode: RequestMode | string,
    assetPaths: ReadonlySet<string>,
): RequestPlan {
    if (assetPaths.has(pathname)) return 'precached-asset';
    if (mode === 'navigate') return 'navigation';
    return 'passthrough';
}

/**
 * Whether a network response fetched for a precached-asset URL may be written
 * back to the cache. Rejects non-200s and - because Cloudflare Pages serves
 * the SPA fallback with HTTP 200 and `text/html` for asset paths missing from
 * the current deployment - anything HTML-typed. Prerendered pages are the one
 * legitimately-HTML asset class; they were already cached by install(), so
 * refusing to re-cache them at runtime costs nothing.
 */
export function isCacheableAssetResponse(status: number, contentType: string | null): boolean {
    if (status !== 200) return false;
    return !(contentType ?? '').toLowerCase().includes('text/html');
}
