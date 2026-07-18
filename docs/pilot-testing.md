# Single-User Pilot (Planned)

> **Status:** Planned - deliberately **gated behind v0.4.0 completion and a cleared
> [known-issues.md](known-issues.md) backlog**. Nothing here should be executed before that
> gate; this document records the decided approach so it isn't re-litigated later.

## Goal

Give the app to **exactly one trusted tester** for an extended feedback loop before any wider
audience. The tester is a pastor/student - a perfect representative of the target audience -
but **non-technical**: no git, no GitHub, no command line. The distribution mechanism must
therefore be "tap a link, use an app," nothing more.

## Entry Gate

Do **not** hand over the app until:

1. **v0.4.0 is complete** - all remaining unchecked items in the roadmap milestone (Strong's
   search, lexicon lookup UI, graph enrichment, theme threading, scratch pad, semantic search,
   split-view completion, maps).
2. **known-issues.md is cleared** - every open item fixed or explicitly accepted-and-documented.
3. **The first-run seed has a progress screen** (known-issues #16). This is the hard blocker
   within the backlog: the 1–2 minute silent first seed *will* make a non-technical tester
   assume the app is broken and close the tab. A "Setting up your Bible… (one-time, ~2 min)"
   screen with per-dataset progress and visible errors is the single biggest determinant of
   the pilot's first five minutes.
4. **A zero-friction feedback path exists.** Since there is no backend, add a small
   "Send feedback" button (Settings or footer) opening a `mailto:` pre-filled with the app
   version and current book/chapter - and/or agree on whatever channel the tester already uses
   daily (WhatsApp screenshots beat anything we build).

## Tester Research (July 2026)

Findings from a pre-pilot conversation with the tester about his current study workflow.

**Profile:** Theology student who teaches/preaches regularly. Pays for **two** study tools
today: Logos (paid tier) and the ESV website ($4.99/mo for study bibles + commentaries).
Also uses a free Greek/Hebrew root-study site (likely Blue Letter Bible or BibleHub) for
word studies. Articulate about what he pays for and why - a strong feedback source.

**What his answers validate on the roadmap:**

| His signal | Roadmap item it validates |
|---|---|
| "Easy to use and free … would be a blessing to so many people" - asked directly about an all-in-one free tool | The core thesis. Note he stressed *easy to use* as hard as *free*. |
| Logos's weakness: "been using it for a bit and still don't understand how to fully utilize it" | UX simplicity as the axis to win on (progressive disclosure, node caps, "clarity over flair") - Logos's problem is usability, not capability |
| Uses a separate site for Greek/Hebrew word studies | v0.4.0 Strong's search + lexicon UI - replaces one of his three tools outright; lead the pilot demo with this |
| Pays $4.99/mo specifically because commentaries/study bibles "are expensive" | v0.5.0 Matthew Henry + v1.1.0 commentary framework - public domain = genuinely free, not just cheap |
| Uses Logos free extensively but pays **only** for the sermon builder ("otherwise I wouldn't pay for it") | v1.2.0 Sermon & Teaching Prep is empirically the feature a real pastor pays for - remember this for sustainability decisions |
| Values Logos as a *library* - "genuine books … John Calvin's works … Christian history" | v0.5.0 Church Fathers Library + v0.6.0 `.csdata` bundles; suggests a general classic-theology-library bundle type eventually |

**Expectation gaps to manage at handoff:**

1. **He reads the ESV** - copyrighted, so it can never ship. Frame the pilot around what our
   translations *enable* (word study, cross-references, entities), not as his daily reading
   Bible replacement, or the mismatch becomes his first impression.
2. **His baseline is Logos's free tier**, a mature product - not "nothing." The comparison
   axis we win on today is usability, per his own complaint.

## Distribution: Cloudflare Pages + Cloudflare Access (both free)

The app is a static SPA (`adapter-static`, no server), so it deploys to any static host. The
chosen approach:

- **Cloudflare Pages** hosts the build for free. Build command `pnpm build`, output dir
  `build`. The processed data JSON must be present at build time (`pnpm setup:data` →
  `copy-to-static`) because client seeding fetches it as static assets.
- **Cloudflare Access** (Zero Trust, free tier covers up to 50 users) puts an email gate in
  front of the URL with a **one-email allow-list**. The tester enters his email, receives a
  6-digit one-time code, and is in. Anyone else hits a login wall. No passwords to manage and
  no accounts built into the app - which keeps the
  [no-accounts design decision](sync-and-accounts.md) intact.

**Setup steps (when the gate is passed):**

1. Connect the private GitHub repo to Cloudflare Pages (repo stays private), or deploy manually
   with `wrangler pages deploy`.
2. Zero Trust → Access → Applications: add the Pages domain, policy *Allow → Emails → \<tester's
   email\>*. Set a long session duration (e.g. 1 month) so code re-entry stays rare.
3. Send the tester the URL with instructions: open in Chrome (or Safari on iPhone), enter
   email + code, then **"Add to Home Screen" / "Install app."**

**Fallback:** if the OTP step proves too much friction, an unlisted URL with no gate is
acceptable for this threat model - there is no server-side data and nothing sensitive exposed;
"access control" is simply not sharing the link. Access is preferred; friction must not stall
the pilot.

## Update Loop

Every deploy is picked up automatically: the PWA fetches the new version on the tester's next
online launch (the service worker updates in the background). The Access email gate only
reappears when the session expires *and* the tester is online - which is also the only time
updates flow. Offline use is unaffected either way because the app is offline-first.

## Things to Tell the Tester

- The **first open takes ~2 minutes** while the Bible data loads (one-time). *(Moot once the
  progress screen ships, but say it anyway.)*
- **Notes and highlights live only on this device** - sync arrives in v0.8.0. Do not "clear
  site data" in the browser.
- **Install to the home screen.** On iOS especially, an installed PWA's storage is far safer
  from Safari's 7-day eviction than a browser tab. (The app also requests
  `navigator.storage.persist()` at boot - known-issues #7 fix.)
