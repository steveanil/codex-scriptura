import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@codex-scriptura/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
            '@codex-scriptura/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
            $lib: path.resolve(__dirname, 'src/lib'),
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
