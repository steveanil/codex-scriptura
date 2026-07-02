# GitHub Repository Setup Guide

As an open-source project aiming for broader adoption and contribution, setting up the GitHub repository metadata correctly is critical for discoverability and contributor onboarding.

## 1. Repository Details

- **Name**: `codex-scriptura`
- **Description**: An offline-first, plugin-extensible Bible study platform for serious academic and theological research.
- **Website (Homepage)**: *Leave blank for now, or link to a Vercel/Cloudflare pages deployment of the app if you host a live demo.*
- **Topics/Tags**: 
  - `bible`
  - `theology`
  - `sveltekit`
  - `offline-first`
  - `pwa`
  - `indexeddb`
  - `typescript`
  - `plugin-architecture`

## 2. Issue Labels

Delete the default GitHub labels and create these semantic ones (colors are up to you, but keep them consistent):

**Types:**
- `Type: Feature` (New functionality)
- `Type: Bug` (Something is broken)
- `Type: Documentation` (README or `/docs` updates)
- `Type: Refactor` (Code cleanup, no feature change)
- `Type: Maintenance` (Deps updates, CI/CD)

**Status & Triage:**
- `Status: Help Wanted` (Great for marking issues you want community help on)
- `Status: Good First Issue` (Simple bugs/features for new contributors)
- `Status: Blocked` 
- `Status: Needs Triage` (Default for new issues)

**Scopes:**
- `Scope: Data Pipeline`
- `Scope: Core DB`
- `Scope: Reader UI`
- `Scope: Search`
- `Scope: Plugin API`

## 3. Recommended First Commits & Branches

Based on the [Branching Strategy](branching-strategy.md) and the work done so far, here is how you should structure your initial push to GitHub.

### Step 1: The "Initial Commit" (Direct to `main`)
You want your `main` branch to start with a clean baseline. 

```bash
git checkout main
git add .
git commit -m "chore: initial commit of Codex Scriptura v0.1.0 baseline"
git push -u origin main
```
*Note: Since the work is already done and verified entirely locally, it's acceptable to make this first massive commit directly to main as the "Genesis" commit of the repository.*

### Step 2: Milestone & Issues Setup
Go to GitHub and create **Milestone: v0.1.0 Foundation**.
Create an Issue: **"Add PWA offline support and service worker #1"** and assign it to the v0.1.0 milestone.

### Step 3: Your First Feature Branch
Now you simulate the standard workflow for the remaining v0.1.0 task:

```bash
git checkout -b feat/pwa-offline-support
# ... do the work (adapter-static, service worker) ...
git commit -m "feat(ui): add PWA service worker and static adapter"
git push -u origin feat/pwa-offline-support
```

Open a Pull Request on GitHub. Squash and merge it.

### Step 4: Tagging the First Release
Once that PR is merged, `main` contains the complete v0.1.0.

```bash
git checkout main
git pull origin main
git tag -a v0.1.0 -m "Release v0.1.0 Foundation"
git push origin v0.1.0
```

Go to GitHub Releases, click "Draft a new release", select the `v0.1.0` tag, and click **Generate release notes**. Title it **v0.1.0: Foundation**.

## 4. Templates (To be added later)
Once the project grows, you should add `.github/ISSUE_TEMPLATE/bug_report.md` and `.github/PULL_REQUEST_TEMPLATE.md`. For a solo dev pre-1.0, these are overkill right now. Keep it simple.
