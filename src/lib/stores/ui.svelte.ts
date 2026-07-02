export type HoverPreviewState = {
    isOpen: boolean;
    osisId: string;
    translationId: string;
    triggerEl: HTMLElement | null;
};

export class UIState {
    annotationSidebarOpen = $state(false);
    hoverPreview = $state<HoverPreviewState>({ isOpen: false, osisId: '', translationId: '', triggerEl: null });
}

export const ui = new UIState();
