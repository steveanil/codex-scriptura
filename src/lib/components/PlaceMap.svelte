<script lang="ts">
    import { onMount } from 'svelte';
    import 'leaflet/dist/leaflet.css';

    let { lat, lng, name }: { lat: number; lng: number; name: string } = $props();

    let mapEl = $state<HTMLDivElement>();
    // Tiles come from the network; when offline show the fallback note
    // instead of leaflet's grey void (offline-first app, network-only maps).
    let online = $state(true);
    let map: import('leaflet').Map | undefined;
    let marker: import('leaflet').Marker | undefined;

    onMount(() => {
        online = navigator.onLine;
        const onOnline = () => { online = true; };
        const onOffline = () => { online = false; };
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);

        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
            map?.remove();
            map = undefined;
        };
    });

    // (Re)build the map whenever it should be visible and the target moves.
    // Dynamic import keeps leaflet out of the SSR bundle (it touches window).
    $effect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lat; lng; // track
        if (!online || !mapEl) {
            // The map's container is unmounted while offline; drop the
            // instance so coming back online rebuilds it on the fresh node.
            map?.remove();
            map = undefined;
            marker = undefined;
            return;
        }

        const el = mapEl;
        let cancelled = false;
        (async () => {
            const L = await import('leaflet');
            if (cancelled) return;

            if (!map) {
                map = L.map(el, {
                    zoomControl: true,
                    scrollWheelZoom: false, // the panel scrolls; don't hijack the wheel
                    attributionControl: true,
                });
                L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 12,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                }).addTo(map);
            }
            map.setView([lat, lng], 8);

            // A themed dot instead of leaflet's default icon: the default
            // marker PNGs 404 under bundlers unless their paths are patched.
            marker?.remove();
            marker = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: 'place-map-dot',
                    iconSize: [14, 14],
                    iconAnchor: [7, 7],
                }),
                title: name,
                keyboard: false,
            }).addTo(map);
        })();

        return () => { cancelled = true; };
    });
</script>

{#if online}
    <div class="place-map" bind:this={mapEl} role="img" aria-label="Map showing the location of {name}"></div>
{:else}
    <div class="place-map place-map-offline">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 1l22 22" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" /><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.58 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><path d="M12 20h.01" />
        </svg>
        <span>Map tiles need a connection</span>
    </div>
{/if}

<style>
    .place-map {
        height: 200px;
        margin-top: var(--space-3);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        overflow: hidden;
        /* Leaflet sets its own z-indexes up to 1000; contain them so the
           map never floats above overlays like the command palette. */
        isolation: isolate;
        z-index: 0;
        position: relative;
    }
    .place-map-offline {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        height: 120px;
        color: var(--color-text-muted);
        font-size: var(--font-size-xs);
        background: var(--color-bg-surface);
    }
    :global(.place-map-dot) {
        background: var(--color-accent);
        border: 2.5px solid #fff;
        border-radius: 50%;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    }
    /* Tone the light OSM tiles down in dark mode so the panel stays cohesive */
    :global([data-theme='dark']) .place-map :global(.leaflet-tile-pane) {
        filter: grayscale(0.3) brightness(0.75) contrast(1.05);
    }
    .place-map :global(.leaflet-control-attribution) {
        font-size: 9px;
    }
</style>
