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

    /**
     * Reader workspace requests the icon-rail sidebar while a split is
     * open (panes > 1) so verse columns get the width. ORed with the
     * user's own collapse toggle in the shell; cleared on split exit.
     */
    splitRail = $state(false);
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

    // One-shot prefill for the annotation sidebar's note editor, used by
    // the scratch pad's "Convert to note" (issue #23). Same counter idiom
    // as commandPaletteRequest: the sidebar consumes a request exactly
    // once, keyed on the counter, so no effect write-loops.
    notePrefill = $state<{ text: string; anchors: string[]; request: number }>({ text: '', anchors: [], request: 0 });

    openCommandPalette() {
        this.commandPaletteRequest++;
    }

    /** Open the annotation sidebar with the note editor pre-populated and anchored to explicit OSIS ids. */
    requestNotePrefill(text: string, anchors: string[]) {
        this.notePrefill = { text, anchors, request: this.notePrefill.request + 1 };
        this.annotationSidebarOpen = true;
    }

    openGenealogyTree(rootId = 'noah_2210') {
        this.genealogyTree = { isOpen: true, rootId };
    }

    closeGenealogyTree() {
        this.genealogyTree = { ...this.genealogyTree, isOpen: false };
    }
}

export const ui = new UIState();
