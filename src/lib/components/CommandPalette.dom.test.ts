// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const prefs = vi.hoisted(() => ({ value: { activeTranslation: 'KJV' } }));
const manager = vi.hoisted(() => ({
    getOrBuildIndex: vi.fn(async () => ({ search: () => [] })),
    releaseIndex: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/preferences.svelte', () => ({ preferences: prefs }));
vi.mock('$lib/search/index-manager', () => manager);
vi.mock('@codex-scriptura/db', () => ({ db: {} }));

import CommandPalette from './CommandPalette.svelte';

beforeEach(() => {
    prefs.value.activeTranslation = 'KJV';
    manager.getOrBuildIndex.mockClear();
    manager.releaseIndex.mockClear();
});
afterEach(cleanup);

const toggle = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

describe('CommandPalette index ownership (issue #164)', () => {
    it('releases the previous translation\'s index when the active translation changes', async () => {
        render(CommandPalette);

        await toggle(); // open on KJV
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledWith('KJV'));
        await toggle(); // close

        prefs.value.activeTranslation = 'WEB';
        await toggle();
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledWith('WEB'));

        expect(manager.releaseIndex).toHaveBeenCalledTimes(1);
        expect(manager.releaseIndex).toHaveBeenCalledWith('KJV');
    });

    it('releases nothing when it reopens on the same translation', async () => {
        render(CommandPalette);

        await toggle();
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledTimes(1));
        await toggle();
        await toggle();
        await waitFor(() => expect(manager.getOrBuildIndex).toHaveBeenCalledTimes(2));

        expect(manager.releaseIndex).not.toHaveBeenCalled();
    });
});
