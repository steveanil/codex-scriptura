<div align="center">
  <h1>Codex Scriptura</h1>
  <p>An offline-first, plugin-extensible Bible study platform for serious academic and theological research.</p>
  
  <p>
    <a href="#vision">Vision</a> •
    <a href="#current-status">Status</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#documentation">Documentation</a>
  </p>
</div>

---

## 📖 Vision

**Codex Scriptura** takes the interconnected, graph-based knowledge management of tools like Obsidian and applies it to the biblical text. Designed for scholars, pastors, missionaries, and serious students, it provides the depth of expensive commercial tools (like Logos or Accordance) in an **open-source, free, and deeply extensible** package.

Because biblical research happens everywhere—from libraries to airplanes to remote villages—**Codex Scriptura is offline-first by design.** The entire biblical text, your annotations, and cross-reference graphs live locally on your device.

## Current Status: v0.1.0 "Foundation" (In Progress)

The foundation of the platform is currently being laid. 
- **What's Working:** App shell, multi-translation SQLite/Dexie database, offline-first reader UI, MiniSearch full-text search, and automated data pipelines for parsing OSIS/USFX texts (KJV, WEB, OEB).
- **Next Up:** v0.2.0 "Annotate" (Highlights, Notes, Bookmarks).

See the [Roadmap](docs/roadmap.md) for the full 1.0 trajectory.

## 🛠 Tech Stack

Codex Scriptura uses a modern, lightweight, edge-ready TypeScript stack:

- **Framework:** SvelteKit 5 (Runes mode)
- **Styling:** Vanilla CSS (CSS Variables)
- **State Management:** Svelte 5 Runes (Global reactive User Preferences)
- **Storage:** Dexie.js (IndexedDB wrapper) for offline-first persistence
- **Search:** MiniSearch (in-memory client-side indexing)
- **Monorepo:** pnpm workspaces
- **Data Pipeline:** Node.js (tsx) + raw XML/regex parsers for Biblical formats

## Repository Structure

We use a monorepo structure to keep the core domains isolated and extensible:

```text
codex-scriptura/
├── src/                      # The SvelteKit PWA App Shell
│   ├── routes/               # UI: /read, /search, etc.
│   └── lib/                  # Svelte components & auth logic
├── packages/                 
│   ├── core/                 # Shared types, Bible ref parsing, Canonical lists
│   ├── db/                   # Dexie.js schema & repository abstractions
│   ├── data-pipeline/        # Node.js importers for OSIS/USFX texts
│   └── plugin-api/           # [Upcoming] Sandboxed extension APIs
├── data/                     
│   ├── texts/                # Source XML files (e.g. eng-kjv.osis.xml)
│   └── processed/            # Pipeline output (JSON seed files)
├── static/data/              # Data served to the client for DB seeding
└── docs/                     # Project documentation
```

## Getting Started (Local Development)

### Prerequisites
- Node.js 20+
- pnpm 10+
- The Bible source texts (downloaded or available in `data/texts/`)

### 1. Install Dependencies
```bash
git clone https://github.com/YOUR_ORG/codex-scriptura.git
cd codex-scriptura
pnpm install
```

### 2. Build the Data Seed
The app requires JSON verse data to load into IndexedDB on first launch. 
To generate this from the source XML:
```bash
cd packages/data-pipeline
pnpm run import:all
# This extracts raw XML into /static/data/ JSON files.
```

### 3. Start the Dev Server
```bash
cd ../../
pnpm dev
```
Navigate to `http://localhost:5173`. 
*Note: On first load, the app will read the JSON files from `/static/data` and seed your local IndexedDB. Subsequent loads will be instantaneous.*

## Documentation

Detailed documentation is available in the `docs/` folder:

- [Getting Started](docs/getting-started.md)
- [Local Development & Data Seeding](docs/local-development.md)
- [Architecture & Plugin System](docs/architecture.md)
- [Git Branching Strategy](docs/branching-strategy.md)
- [Commit Message Conventions](docs/commit-conventions.md)
- [Release Process](docs/release-process.md)
- [Project Roadmap](docs/roadmap.md)

## Contributing

We welcome contributions! As an early-stage project, we are actively looking for help building core features and plugins. 
Please review our [Contributing Guide](docs/contributing.md) and our [Commit Conventions](docs/commit-conventions.md) before opening a PR.

## License

GPL-3.0
