import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import path from 'node:path';

export default defineConfig({
    // Compiles .svelte.ts rune modules (PaneState) so store logic is
    // testable outside a component (issue #171). svelteTesting adds the
    // browser resolve condition so a component test (a file with the
    // `@vitest-environment jsdom` docblock) gets the client build instead
    // of the SSR one.
    plugins: [svelte(), svelteTesting()],
    resolve: {
        alias: {
            '@codex-scriptura/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
            '@codex-scriptura/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
            $lib: path.resolve(__dirname, 'src/lib'),
            // SvelteKit's virtual module does not exist outside the kit build
            '$app/navigation': path.resolve(__dirname, 'tests/stubs/app-navigation.ts'),
        },
    },
    test: {
        environment: 'node',
        include: [
            'packages/*/src/**/*.test.ts',
            'src/**/*.test.ts',
        ],
    },
});
