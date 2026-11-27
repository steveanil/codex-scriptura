// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { preferences } from '$lib/stores/preferences.svelte';
import AppearanceSection from './AppearanceSection.svelte';

beforeEach(async () => {
    await preferences.load();
    preferences.update({ accentColor: '#5e9ed6', accentColorLight: undefined });
});
afterEach(cleanup);

function findButton(text: string): HTMLButtonElement | null {
    return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
}
const darken = () => findButton('Darken for light theme');
const oneHue = () => findButton('Use one hue for both themes');
const lightReadout = () => [...document.querySelectorAll('.contrast b')][1].textContent ?? '';

describe('AppearanceSection light accent (#456)', () => {
    it('Use one hue stores the hue, and Darken clears it so the resolver takes over', async () => {
        render(AppearanceSection);
        expect(lightReadout()).toMatch(/^AA .* on light \(#426f96\)$/);
        expect(darken()).toBeNull();

        await fireEvent.click(oneHue()!);
        expect(preferences.value?.accentColorLight).toBe('#5e9ed6');
        expect(lightReadout()).toMatch(/fails AA$/);

        await fireEvent.click(darken()!);
        expect(preferences.value?.accentColorLight).toBeUndefined();
        expect(lightReadout()).toMatch(/^AA /);
        expect(oneHue()).not.toBeNull();
    });

    // What the old Darken button stored: AA on the page background, short of it on a hovered row
    it.each([
        ['#5e9ed6', '#4676a0'],
        ['#8a6ec4', '#7c63b0'],
        ['#3f8f7a', '#377d6b'],
        ['#e0891d', '#a26315'],
        ['#d16a8f', '#ac5776'],
    ])('a light accent %s stored by the old Darken button (%s) reads as failing and can be darkened again', async (accentColor, accentColorLight) => {
        preferences.update({ accentColor, accentColorLight });
        render(AppearanceSection);
        expect(lightReadout()).toMatch(/fails AA/);

        await fireEvent.click(darken()!);
        expect(preferences.value?.accentColorLight).toBeUndefined();
        expect(lightReadout()).toMatch(/^AA /);
    });

    it('one hue on Violet, which passes on the page but not on a hovered row, still offers Darken', async () => {
        const { getByRole } = render(AppearanceSection);
        await fireEvent.click(getByRole('radio', { name: 'Violet' }));
        expect(lightReadout()).toMatch(/^AA .* \(#6657db\)$/);

        await fireEvent.click(oneHue()!);
        expect(preferences.value?.accentColorLight).toBe('#6b5ce7');
        expect(lightReadout()).toMatch(/fails AA$/);
        expect(darken()).not.toBeNull();
    });
});
