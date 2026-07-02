import { ui } from '$lib/stores/ui.svelte';

let openTimeout: ReturnType<typeof setTimeout> | null = null;
let closeTimeout: ReturnType<typeof setTimeout> | null = null;

const OPEN_DELAY = 350;
const CLOSE_DELAY = 300;

export function verseHover(node: HTMLElement, params: { osisId: string | null; translationId: string | null }) {
    let p = params;

    function enter() {
        if (!p.osisId || !p.translationId) return;
        if (closeTimeout) clearTimeout(closeTimeout);
        if (openTimeout) clearTimeout(openTimeout);
        
        // Already open for this exact verse? Keep it open
        if (ui.hoverPreview.isOpen && ui.hoverPreview.osisId === p.osisId) return;
        
        openTimeout = setTimeout(() => {
            if (p.osisId && p.translationId) {
                ui.hoverPreview = { 
                    isOpen: true, 
                    osisId: p.osisId, 
                    translationId: p.translationId, 
                    triggerEl: node 
                };
            }
        }, OPEN_DELAY);
    }

    function leave() {
        if (openTimeout) clearTimeout(openTimeout);
        if (closeTimeout) clearTimeout(closeTimeout);
        closeTimeout = setTimeout(() => {
            if (ui.hoverPreview.triggerEl === node) {
                ui.hoverPreview.isOpen = false;
            }
        }, CLOSE_DELAY);
    }

    node.addEventListener('mouseenter', enter);
    node.addEventListener('mouseleave', leave);
    node.addEventListener('focus', enter);
    node.addEventListener('blur', leave);

    return {
        update(newParams: { osisId: string | null; translationId: string | null }) {
            p = newParams;
        },
        destroy() {
            node.removeEventListener('mouseenter', enter);
            node.removeEventListener('mouseleave', leave);
            node.removeEventListener('focus', enter);
            node.removeEventListener('blur', leave);
        }
    };
}

export function keepPreviewOpen() {
    if (closeTimeout) clearTimeout(closeTimeout);
}

export function closePreview() {
    if (closeTimeout) clearTimeout(closeTimeout);
    closeTimeout = setTimeout(() => {
        ui.hoverPreview.isOpen = false;
    }, CLOSE_DELAY);
}

export function forceClosePreview() {
    if (openTimeout) clearTimeout(openTimeout);
    if (closeTimeout) clearTimeout(closeTimeout);
    ui.hoverPreview.isOpen = false;
}
