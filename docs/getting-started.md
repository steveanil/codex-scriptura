# Getting Started with Codex Scriptura

Welcome to Codex Scriptura! This guide is for developers and contributors who want to set up the project locally.

## Prerequisites

1.  **Node.js**: Version 20 or higher.
2.  **pnpm**: Version 10 or higher. We use `pnpm` workspaces for our monorepo.
3.  **Git**: For version control.

## Initial Setup

Clone the repository and install the monorepo dependencies:

```bash
git clone https://github.com/YOUR_ORG/codex-scriptura.git
cd codex-scriptura
pnpm install
```

## Understanding the Monorepo

We use a modular architecture broken down into packages:
-   `packages/core`: The foundation. Contains the canonical book lists (81 books), TypeScript types (`VerseRecord`, `Translation`), and the `BibleReference` parsing engine.
-   `packages/db`: The offline persistence layer. Wraps IndexedDB using Dexie.js. Defines the tables (verses, annotations, tags) and exports repository methods (`getChapter`, `getVerse`).
-   `packages/data-pipeline`: Node.js scripts that convert raw XML Bible files (OSIS and USFX formats) into optimized JSON seed files.
-   `src/`: The main SvelteKit application containing the UI components and pages.

## Next Steps

To actually run the app, you need data. Follow the instructions in the [Local Development & Data Seeding](local-development.md) guide to import the Bible texts and start the dev server.
