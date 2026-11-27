// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ChapterPills from './ChapterPills.svelte';
import { PaneState } from '$lib/stores/splitPanes.svelte';

// jsdom has no layout, so no scrollIntoView
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

afterEach(() => {
    cleanup();
    scrollIntoView.mockClear();
});

function setup() {
    const pane = new PaneState({ book: 'Ruth', chapter: 2, translation: 'KJV' });
    pane.availableChapters = [1, 2, 3, 4];
    pane.loading = false;
    const navigateToChapter = vi.spyOn(pane, 'navigateToChapter').mockResolvedValue();
    const { container } = render(ChapterPills, { pane });
    return { pane, navigateToChapter, container };
}

describe('ChapterPills', () => {
    it('renders one pill per chapter and marks the current one', () => {
        const { container } = setup();
        expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['1', '2', '3', '4']);
        expect([...container.querySelectorAll('.chapter-pill.active')].map((b) => b.textContent)).toEqual(['2']);
    });

    it('navigates the pane to the clicked chapter', async () => {
        const { navigateToChapter } = setup();
        await fireEvent.click(screen.getByRole('button', { name: '4' }));
        expect(navigateToChapter).toHaveBeenCalledWith(4);
    });

    it('scrolls the active pill into view when a chapter load finishes, not on mount', () => {
        const { pane } = setup();
        expect(scrollIntoView).not.toHaveBeenCalled();
        pane.loading = true;
        pane.chapter = 3;
        flushSync();
        expect(scrollIntoView).not.toHaveBeenCalled();
        pane.loading = false;
        flushSync();
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('button', { name: '3' }));
    });

    it('turns a vertical wheel into horizontal scroll', async () => {
        const { container } = setup();
        const strip = container.querySelector('.chapter-pills') as HTMLElement;
        const vertical = new WheelEvent('wheel', { deltaY: 40, deltaX: 0, cancelable: true });
        strip.dispatchEvent(vertical);
        expect(strip.scrollLeft).toBe(40);
        expect(vertical.defaultPrevented).toBe(true);
        const sideways = new WheelEvent('wheel', { deltaY: 0, deltaX: 30, cancelable: true });
        strip.dispatchEvent(sideways);
        expect(sideways.defaultPrevented).toBe(false);
    });
});
