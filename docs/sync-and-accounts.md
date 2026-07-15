# Sync & Accounts Strategy

> **Status:** Design document (targets v0.8.0 for personal sync; v1.4.0 for community backend).
> Decision from the July 2026 review: **no user accounts for personal use — ever, if we can help it.**
> Sync and backup are delivered without Codex Scriptura holding anyone's data; accounts appear
> only if/when community features genuinely require them, and remain optional even then.

---

## 1. Why "no accounts" is a feature

Codex Scriptura is offline-first and local-only. Everything a user creates — highlights, notes,
prayer-adjacent annotations, reading history — lives in their browser. This is a *differentiator*,
not a limitation:

- **Privacy:** religious annotation data is sensitive (doubts, prayers, personal study). The
  strongest privacy guarantee is not holding the data at all.
- **No liability:** no credential storage, no breach surface, no GDPR/CCPA data-controller
  obligations, no backend bill.
- **Trust story:** "your data never leaves your device unless *you* send it somewhere *you* own"
  is a pitch no incumbent Bible platform can make.

What users actually want from accounts is **backup** and **multi-device sync**. Both are
deliverable without accounts.

---

## 2. The three phases

### Phase 0 — Export/Import as backup (v0.8.0, already on roadmap)
The bidirectional JSON export/import **is** the backup story. Ship it early and make it prominent
(Settings → "Back up my library"). Everything below builds on the same export schema.

### Phase 1 — Client-side E2EE sync to user-owned storage (v0.8.0)
Sync the export payload to storage *the user already owns* — Google Drive first (largest install
base), Dropbox later. Key properties:

- **OAuth happens entirely in the browser** (PKCE flow). Tokens live on the device; no server of
  ours ever sees them.
- **Google Drive `appDataFolder`** scope: an app-private folder, no access to the user's other
  files — narrowest possible permission, easiest consent screen.
- **End-to-end encrypted:** the payload is encrypted with WebCrypto (AES-GCM) using a key derived
  from a user passphrase (PBKDF2, high iteration count). Google stores ciphertext. Losing the
  passphrase loses the sync copy — communicated clearly at setup ("this is a backup key, write it
  down"). Unencrypted sync is *not* offered; one mode, no confusing choice.
- **Merge model (v1):** per-record last-write-wins using the existing `modified` timestamps on
  annotations, plus tombstone records for deletions (`synced` field on `Annotation` already
  anticipates this). Whole-payload snapshot sync is acceptable at v1 scale (annotations are KBs,
  not MBs); per-record delta sync (CRDT) is a later optimization, not a prerequisite.
- **What syncs:** annotations, tags, saved searches, scratch pad, preferences, custom narratives.
  **What never syncs:** seeded datasets (verses, entities, cross-refs — re-seedable on any device).

### Phase 2 — Managed provider for community features only (v1.4.0)
Shared study guides, published annotation layers, plugin-marketplace ratings, and forkable reading
plans require data that lives *between* users — that genuinely needs a backend and accounts.

- **Provider:** a managed service — **Supabase recommended** over Firebase for this project:
  Postgres + row-level security fits the relational data (annotation layers, subscriptions,
  ratings); it's open-source and self-hostable (aligned with project values, and an exit hatch
  from vendor lock-in); auth supports OAuth and passkeys out of the box. Firebase is a fine
  fallback if realtime collaboration ever dominates the requirements.
- **Auth rules:** passkeys or third-party OAuth **only** — never roll our own password auth.
- **Accounts are strictly optional.** The entire local experience, including Phase 1 sync, works
  with no account forever. An account unlocks only publishing/subscribing/social features.
- **Published content is public by design** (that's its purpose), so E2EE doesn't apply to it.
  Private user data continues to live locally / in Phase 1 sync — the community backend never
  becomes a silent home for private notes.

---

## 3. Google Drive OAuth vs. Supabase/Firebase — different jobs

These are commonly confused because both "put data in the cloud." They occupy different roles:

| | **User-owned storage (Drive/Dropbox OAuth)** | **Managed provider (Supabase/Firebase)** |
|---|---|---|
| **Job** | Transport for *personal* backup/sync | Backend for *shared/community* data |
| **Who owns the data** | The user (their Google account) | You (the app operator) hold it for users |
| **Account with us needed** | No | Yes |
| **Infra we run / pay for** | None | Database, auth, storage, egress |
| **Legal/privacy posture** | We're not a data controller | Full data-controller obligations (privacy policy, GDPR export/delete, breach liability) |
| **E2EE** | Yes, always (we only ever handle ciphertext) | Possible for personal blobs; impossible for content meant to be shared/queried server-side |
| **Enables** | Backup, multi-device sync | Sharing, publishing, subscriptions, ratings, group study, realtime collaboration |
| **Cannot do** | Anything involving another user | Being "zero-knowledge" for public content |

**Can Supabase/Firebase eventually replace Drive OAuth?** Technically yes — a managed provider can
store personal E2EE sync blobs too, and some local-first apps use only that. But replacing Drive
sync with Supabase sync would mean: every syncing user now needs an account, we pay for their
storage, and we hold (encrypted) personal data with all the posture change that implies. That
trades away the project's core privacy differentiator for no user-visible gain.

**Decision:** the two *coexist* long-term with distinct jobs:

1. **Drive/Dropbox E2EE sync stays the default personal path** — accountless, zero-knowledge.
2. **Supabase arrives only with community features** and touches only community data.
3. *Optional convenience (post-v1.4.0):* users who already have an account for community features
   may choose Supabase as an alternative personal-sync target (still E2EE, same encrypted payload
   format — the sync engine treats Drive/Dropbox/Supabase as interchangeable "remotes"). This is
   an offering, never a migration.

---

## 4. Implementation notes for Phase 1

- The sync engine consumes the v0.8.0 export schema — build export/import first; sync is "export,
  encrypt, upload; download, decrypt, import(merge)".
- Abstract the remote as a tiny interface (`list/get/put` on named blobs) so Drive, Dropbox, and
  later Supabase are drop-in providers.
- Google OAuth client ID is public by design in PKCE flows (no secret shipped).
- Sync state machine must tolerate: expired tokens (silent re-auth prompt), quota errors, and
  concurrent edits from another device (compare remote snapshot version before upload; merge on
  conflict rather than clobber).
- Prerequisite hygiene: consolidate all user-created data into enumerable Dexie tables first
  (see known-issues.md #15 — nav history currently pollutes `settings`).

## 5. What this unlocks on the roadmap

- **v0.8.0** gains: "Client-side E2EE sync via user-owned storage (Google Drive first)".
- **v1.4.0** gains: "Community backend on a managed provider (Supabase), accounts optional".
- The **Offline Bundle Generator** (v2.0.0) reuses the same export payload format.
