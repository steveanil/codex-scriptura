import { describe, it, expect } from 'vitest';
import { planRequest, isCacheableAssetResponse } from './cache-strategy';

const ASSETS = new Set([
    '/_app/immutable/chunks/Cm6XOrHM.js',
    '/_app/immutable/assets/app.B2fD3kQ1.css',
    '/data/kjv-verses.json',
    '/manifest.json',
    '/prerendered-page.html',
]);

describe('planRequest (issue #145)', () => {
    it('serves known assets cache-first regardless of request mode', () => {
        expect(planRequest('/_app/immutable/chunks/Cm6XOrHM.js', 'no-cors', ASSETS)).toBe('precached-asset');
        expect(planRequest('/data/kjv-verses.json', 'cors', ASSETS)).toBe('precached-asset');
        // A prerendered page arrives as a navigation but is still an asset
        expect(planRequest('/prerendered-page.html', 'navigate', ASSETS)).toBe('precached-asset');
    });

    it('routes non-asset navigations to the network-first branch', () => {
        expect(planRequest('/read', 'navigate', ASSETS)).toBe('navigation');
        expect(planRequest('/search', 'navigate', ASSETS)).toBe('navigation');
    });

    it("passes through a previous deployment's dead chunk URLs untouched", () => {
        // The poisoning vector: an outdated page requesting hashed assets
        // that no longer exist. Must be neither served from nor written to
        // the cache.
        expect(planRequest('/_app/immutable/chunks/OldDeploy1.js', 'no-cors', ASSETS)).toBe('passthrough');
        expect(planRequest('/api/whatever', 'cors', ASSETS)).toBe('passthrough');
    });
});

describe('isCacheableAssetResponse (issue #145)', () => {
    it('accepts a real 200 asset response', () => {
        expect(isCacheableAssetResponse(200, 'application/javascript')).toBe(true);
        expect(isCacheableAssetResponse(200, 'application/json')).toBe(true);
        expect(isCacheableAssetResponse(200, null)).toBe(true);
    });

    it('rejects the Pages SPA fallback: 200 with text/html', () => {
        expect(isCacheableAssetResponse(200, 'text/html; charset=utf-8')).toBe(false);
        expect(isCacheableAssetResponse(200, 'TEXT/HTML')).toBe(false);
    });

    it('rejects non-200 responses', () => {
        expect(isCacheableAssetResponse(404, 'application/javascript')).toBe(false);
        expect(isCacheableAssetResponse(304, 'application/javascript')).toBe(false);
        expect(isCacheableAssetResponse(500, null)).toBe(false);
    });
});
