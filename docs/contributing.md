# Contributing to Codex Scriptura

First off, thank you for considering contributing to Codex Scriptura! We are building an open, free, and extensible Bible study platform that rivals expensive commercial tools.

Because we are an early-stage project with a large vision, there are many ways to help—ranging from adding new Bible text importers, to building UI components, to designing the Plugin API.

## How to Contribute

1.  **Check the Roadmap & Issues:** Browse the [Project Roadmap](roadmap.md) and the open issues. Look for issues labeled `Good First Issue` or `Help Wanted`.
2.  **Discuss Before Building:** If you want to add a major feature or a new package, please open an issue to discuss the design and architecture *before* writing code. We want to ensure your work aligns with the offline-first and plugin-extensible vision.
3.  **Fork and Branch:**
    -   Fork the repository.
    -   Create a new branch from `main` following our [Branching Strategy](branching-strategy.md) (e.g., `feat/my-new-feature` or `fix/bug-description`).
4.  **Develop Locally:** Follow the [Local Development Guide](local-development.md) to set up the pnpm monorepo, build the verse JSON seeds, and start the dev server.
5.  **Commit:** Write your commits following our [Commit Message Conventions](commit-conventions.md) (e.g., `feat(ui): add syntax highlighting to note editor`).
6.  **Pull Request:** Open a PR against the `main` branch. Provide a clear description of what the PR does, why it's needed, and link any relevant issues.

## Project Values & Architecture Rules

When writing code for Codex Scriptura, keep these rules in mind:

-   **Offline-First is Non-Negotiable:** If a feature requires a persistent network connection to function, it belongs in a plugin, not the core app. The core app must be fully usable on an airplane.
-   **Dexie/IndexedDB for Persistence:** All core reads and writes go through the `packages/db` abstraction layer.
-   **No "Core Bloat":** If a feature is specific to a certain theological tradition (e.g., a specific lectionary calendar) or highly specialized (e.g., syntactical tree drawing), it should be built as a plugin once the Plugin API is released, rather than added to the core SvelteKit app.

## Need Help?

If you have questions about the codebase, the architecture, or where to start, feel free to open a Discussion on GitHub or reach out on the issue tracker. We are happy to help new contributors get up to speed!
