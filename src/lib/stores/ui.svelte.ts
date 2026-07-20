export type HoverPreviewState = {
    isOpen: boolean;
    osisId: string;
    translationId: string;
    triggerEl: HTMLElement | null;
};

export type GenealogyTreeState = {
    isOpen: boolean;
    /** Theographic person id (or display name to resolve) the tree opens rooted on */
    rootId: string;
};

export class UIState {
    annotationSidebarOpen = $state(false);
    hoverPreview = $state<HoverPreviewState>({ isOpen: false, osisId: '', translationId: '', triggerEl: null });
    genealogyTree = $state<GenealogyTreeState>({ isOpen: false, rootId: 'noah_2210' });

    /** What's New modal (update awareness for the pilot; see whats-new.ts). */
    whatsNewOpen = $state(false);
    /** True when the latest whats-new entry hasn't been seen on this device. */
    hasUnseenUpdates = $state(false);

    // One-shot request counter: incrementing it asks CommandPalette to open.
    // A counter (not a boolean) keeps the palette's open/close state local
    // to the component and avoids effect write-loops (known-issues #31,
    // visible search entry point).
    commandPaletteRequest = $state(0);

    openCommandPalette() {
        this.commandPaletteRequest++;
    }

    openGenealogyTree(rootId = 'noah_2210') {
        this.genealogyTree = { isOpen: true, rootId };
    }

    closeGenealogyTree() {
        this.genealogyTree = { ...this.genealogyTree, isOpen: false };
    }
}

export const ui = new UIState();
