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

    openGenealogyTree(rootId = 'noah_2210') {
        this.genealogyTree = { isOpen: true, rootId };
    }

    closeGenealogyTree() {
        this.genealogyTree = { ...this.genealogyTree, isOpen: false };
    }
}

export const ui = new UIState();
