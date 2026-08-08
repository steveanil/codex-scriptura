/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';
import { planRequest, isCacheableAssetResponse } from '$lib/sw/cache-strategy';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Create a unique cache name for this deployment
const CACHE = `codex-scriptura-cache-${version}`;

// The adapter-static SPA fallback page. It is in neither `build` nor `files`,
// so it must be cached explicitly or offline navigation to a not-yet-visited
// URL has nothing to serve.
const FALLBACK = '/index.html';

// What to cache on install? All JS, CSS, and static files including our huge JSON verse seeds
const ASSETS = [
    ...build,       // the app itself
    ...files,       // everything in `static`, including /data/ web-verses.json etc.
    ...prerendered  // any prerendered pages
];

const ASSET_PATHS: ReadonlySet<string> = new Set(ASSETS);

sw.addEventListener('install', (event) => {
    // Create a new cache and add all files to it
    async function addFilesToCache() {
        const cache = await caches.open(CACHE);
        await cache.addAll(ASSETS);
        // Best-effort: the dev server doesn't serve the fallback page, and a
        // failed addAll would reject the whole install.
        try {
            await cache.add(FALLBACK);
        } catch {
            // fallback unavailable (dev) - offline deep links degrade
        }
    }

    event.waitUntil(addFilesToCache());
    sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
    // Remove previous cached data from disk
    async function deleteOldCaches() {
        for (const key of await caches.keys()) {
            if (key !== CACHE) await caches.delete(key);
        }
    }

    event.waitUntil(deleteOldCaches());
    sw.clients.claim();
});

sw.addEventListener('fetch', (event) => {
    // Ignore non-GET requests
    if (event.request.method !== 'GET') return;

    // Ignore cross-origin requests
    const url = new URL(event.request.url);
    if (url.origin !== sw.location.origin) return;

    const plan = planRequest(url.pathname, event.request.mode, ASSET_PATHS);

    // Unknown same-origin GETs - e.g. an outdated page requesting a previous
    // deployment's hashed chunks - go straight to the network, untouched by
    // the cache. Pages answers dead asset paths with the SPA fallback
    // (200 text/html); serving or storing that under a script URL wedged the
    // app in a reload loop until a hard refresh (issue #145).
    if (plan === 'passthrough') return;

    async function respond(): Promise<Response> {
        const cache = await caches.open(CACHE);

        if (plan === 'precached-asset') {
            // Cache-first: everything here was written by install(), keyed by
            // pathname, and is immutable for this deployment version.
            const cachedResponse = await cache.match(url.pathname);
            if (cachedResponse) return cachedResponse;

            const response = await fetch(event.request);
            if (isCacheableAssetResponse(response.status, response.headers.get('content-type'))) {
                cache.put(url.pathname, response.clone());
            }
            return response;
        }

        // Navigation: network-first so a new deployment's HTML is picked up
        // immediately; offline falls back to the precached SPA shell. Never
        // cached at runtime - a stored page would keep referencing this
        // deployment's chunks after the next deploy replaces them.
        try {
            return await fetch(event.request);
        } catch (err) {
            const indexMatch = await cache.match(FALLBACK);
            if (indexMatch) return indexMatch;
            throw err;
        }
    }

    event.respondWith(respond());
});
