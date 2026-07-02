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