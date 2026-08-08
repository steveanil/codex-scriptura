// Decision logic for the service worker's fetch handler, kept pure so it can
// be unit tested - the worker module itself imports the virtual
// `$service-worker` module and only runs inside a worker scope.

export type RequestPlan = 'precached-asset' | 'navigation' | 'passthrough';

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
