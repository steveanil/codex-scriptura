# Commit Message Conventions

Codex Scriptura strictly follows the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) standard. 

Why? Because when a repository grows and contributors join, a structured commit history acts as the primary form of documentation. It also allows us to automate semantic versioning and changelog generation in the future.

## The Format

```text
type(scope): concise description

[optional body explaining WHY and HOW the changes were made]

[optional footer(s) for issue links or breaking changes]
```

## Types
- `feat`: A new feature (e.g., a new Bible importer)
- `fix`: A bug fix (e.g., fixing a regex match error)
- `docs`: Documentation only changes
- `style`: Formatting, missing semi-colons, etc. (no code change)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process, package managers, or auxiliary tools

## Scopes
The scope should correspond to the monorepo package or core domain being modified:
- `core`
- `db`
- `pipeline`
- `ui`
- `docs`
- `deps`

## Examples from Our History

### 1. Adding a Feature (Data Pipeline)
```text
feat(pipeline): build generic OSIS importer for KJV and OEB

- Extracted KJV regex into generic importOsis function
- Added handling for both osisID-first and sID-first attribute orders
- Wired up runner script for both translation source texts
```

### 2. Fixing a Bug (Data Pipeline)
```text
fix(pipeline): prevent OSIS regex from substring matching inside seID

The KJV importer was returning 0 verses. The `sID=[^"]*` regex was accidentally matching 
inside the `eID="Gen.1.1.seID.0002"` values. Added a whitespace `[\s]` requirement to 
prevent partial attribute matches.
```

### 3. Setting Up Workspace Chores
```text
chore(deps): migrate to pnpm workspaces and add db package

- Created packages/core, packages/db, and packages/data-pipeline
- Set up workspace dependency linking (`workspace:*`)
- Moved Dexie.js from root to db package
```

### 4. Creating Documentation
```text
docs(architecture): propose roadmap and local dev instructions

Added docs/ folder outlining the top-level repository structure, 
offline-first stack, local-development instructions, and 
project vision.
```

## Examples for Future Work

**When you build the Annotation Service:**
`feat(ui): add cross-reference selection overlay to reader page`

**When you bump version 0.2.0:**
`chore(release): bump monorepo packages to v0.2.0`
