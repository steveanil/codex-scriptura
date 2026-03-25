/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Create a unique cache name for this deployment
const CACHE = `codex-scriptura-cache-${version}`;

// What to cache on install? All JS, CSS, and static files including our huge JSON verse seeds
const ASSETS = [
    ...build, // the app itself
    ...files  // everything in `static`, including /data/ web-verses.json etc.
];

sw.addEventListener('install', (event) => {
    // Create a new cache and add all files to it
    async function addFilesToCache() {
        const cache = await caches.open(CACHE);
        await cache.addAll(ASSETS);
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

    // We cache-first all assets (build files and static /data/ JSON)
    async function respond() {
        const cache = await caches.open(CACHE);

        // Does this request exist in the cache?
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            return cachedResponse;
        }

        // If not, fetch from network
        try {
            const response = await fetch(event.request);

            // If it's a 200 response, cache it for next time
            if (response.status === 200) {
                cache.put(event.request, response.clone());
            }

            return response;
        } catch (err) {
            // Network failure — because we are a PWA SPA, return the index.html fallback for navigation requests
            if (event.request.mode === 'navigate') {
                const indexMatch = await cache.match('/index.html');
                if (indexMatch) return indexMatch;
            }
            throw err;
        }
    }

    event.respondWith(respond());
});
