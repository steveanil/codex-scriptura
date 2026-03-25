# Git Branching Strategy

For an early-stage open-source project like Codex Scriptura, an over-engineered corporate GitFlow is unnecessary. Instead, we use a simple, sustainable flavor of **GitHub Flow** optimized for a solo maintainer who is preparing to accept community contributions.

## The Strategy

### 1. The `main` Branch is the Source of Truth
- The `main` branch holds the latest developmental code.
- It should be reasonably stable, but it's not the "production release" branch until a version tag is cut.
- All Pull Requests must target `main`.

### 2. Feature Branches (Short-Lived)
- Never commit directly to `main`.
- Create a new branch off `main` for *every* piece of work.
- **Naming format:** `type/kebab-case-description`

**Examples:**
- `feat/usfx-importer`
- `fix/osis-regex-bug`
- `docs/add-readme`
- `refactor/db-schema`

### 3. Merging via Pull Requests
- Even as a solo maintainer, I will open a PR for my own work. It provides a historical record of *why* a set of changes was made, allowing you to link issues, attach context, and run CI checks (when added later).
- Use **Squash and Merge** when merging into `main`. 
  - *Why?* It keeps the `main` history clean (one commit per feature/fix) and ensures the squashed commit message perfectly matches our [commit conventions](commit-conventions.md).

## Workflow Example: Building the KJV Importer
1. `git checkout main`
2. `git pull origin main`
3. `git checkout -b feat/kjv-osis-importer`
4. Write the parsing logic, tests, and seed scripts.
5. Create multiple small, messy commits as you work: `git commit -m "start regex"`, `git commit -m "fix bug"`
6. Open a PR on GitHub.
7. Squash & Merge with the final message: `feat(pipeline): build KJV OSIS importer for pipeline`
8. Delete the remote branch.

## Why This Simple Approach?
- **Cognitive Load:** You don't have to manage `develop`, `release`, and `hotfix` branches.
- **Contributor friendly:** Anyone knows they just branch off `main` and PR back into `main`.
- **Easy Release Tagging:** When you're ready for v0.2.0, you simply tag a specific commit on `main`.
