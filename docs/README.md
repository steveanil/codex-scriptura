# Codex Scriptura Documentation

Start here. Documents are grouped by what you're trying to do.

## Getting Started

| Document | What it covers |
|---|---|
| [getting-started.md](getting-started.md) | Prerequisites, cloning, and a tour of the monorepo packages |
| [local-development.md](local-development.md) | Data pipeline setup (`pnpm setup:data`), individual pipeline steps, and client-side seeding |
| [contributing.md](contributing.md) | How to contribute, project values, and architecture rules |

## Architecture & Design

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | The application architecture: stack, Dexie schema, search engine, reader workspace, graph engine, and per-feature design notes |
| [data-architecture.md](data-architecture.md) | The data platform: source registry, provenance model, entity resolution, conflict handling, and merge precedence |
| [core-vs-plugins.md](core-vs-plugins.md) | The philosophy for deciding what belongs in core vs. what should be a plugin |
| [plugin-api.md](plugin-api.md) | Draft plugin API contract: manifest, hooks, sandboxing, lifecycle (targeting v0.6.0) |
| [sync-and-accounts.md](sync-and-accounts.md) | Sync & accounts strategy: E2EE sync via user-owned storage (Google Drive OAuth), when/why a managed provider (Supabase) appears, and how the two coexist |

## Data

| Document | What it covers |
|---|---|
| [open-data-sources.md](open-data-sources.md) | Catalog of open biblical datasets, their roles, and the import pipeline phases |

## Project Direction

| Document | What it covers |
|---|---|
| [roadmap.md](roadmap.md) | Version themes and the path to 1.0 - the item-level plan lives in [GitHub Milestones](https://github.com/steveanil/codex-scriptura/milestones) |
| [known-issues.md](known-issues.md) | Pointer to [GitHub Issues](https://github.com/steveanil/codex-scriptura/issues), where bugs are tracked with severity labels |
| [pilot-testing.md](pilot-testing.md) | Single-user pilot plan: entry gate (v0.4.0 complete + known issues cleared), Cloudflare Pages + Access distribution, and tester handoff notes |
| [ecosystem.md](ecosystem.md) | Long-term integration plan with bibleapologist.com |

## Process

| Document | What it covers |
|---|---|
| [branching-strategy.md](branching-strategy.md) | GitHub Flow: feature branches, squash-and-merge PRs |
| [commit-conventions.md](commit-conventions.md) | Conventional Commits format, types, and scopes |
| [release-process.md](release-process.md) | SemVer strategy, tagging, and GitHub Releases |

## Archive

Superseded and one-time documents live in [archive/](archive/README.md). They are kept for history, not guidance.
