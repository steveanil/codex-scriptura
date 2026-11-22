# Backup format

The backup file (Settings > Data > Export backup) is one JSON document holding everything a user made in one browser. The E2EE sync payload (#62, v0.8.0) is this same document, encrypted; sync does not get a second schema. Code: `src/lib/utils/backup-format.ts` (shape, validation, merge plan, all pure) and `src/lib/utils/backup.ts` (database reads and writes).

## The document

```jsonc
{
  "format": "codex-scriptura-backup",   // anything else is refused
  "version": 1,                         // see Versioning
  "exportedAt": 1795313395212,          // ms since epoch
  "app": "2026-09-22",                  // What's New id of the build that wrote it
  "settings": { "id": "default", ... }, // UserPreferences, one record
  "annotations": [ Annotation, ... ],
  "tags": [ Tag, ... ],
  "savedSearches": [ SavedSearch, ... ],
  "scratchPad": { "content": "...", "droppedVerses": [...], "modified": 1795313395000 }  // optional
}
```

Record types are the ones in `packages/core/src/types.ts`. Every record in the three lists has a string `id`, unique within its list, and a last-write timestamp:

| Record | Timestamp | When it is absent |
|---|---|---|
| Annotation | `modified` (always present) | - |
| Tag | `modified` | written before the field existed: read as 0 |
| Saved search | `modified` | read as `created` |
| Scratch pad | `modified` | read as 0 |

The app stamps `modified` on every save (`saveAnnotation`, `saveTag`, `saveSearch`, the scratch pad store). Settings are a single record with no timestamp.

The export reads every table inside one read transaction, so a file never holds half of a write.

## Validation

`parseBackup` checks every record of every type before any transaction opens, and refuses the whole file if one record is bad. Each problem names the record (type, position, id) and the reason. It checks the fields the app reads: annotation type, book, `verseStart`/`verseEnd` as OSIS verse ids in that book, text, tag lists and timestamps; tag name and colour; saved search query, translations and filters; the settings the reader and Settings depend on; the scratch pad's text and verse blocks. Ids repeated within one list are an error.

Fields the parser does not know are kept, not rejected, and written to the database as they are.

## Versioning

- **Additive changes keep the version.** A new optional field on a record (the anchor fields from #434, say) or a new optional top-level section (the scratch pad was one) does not bump `version`. Older builds ignore what they do not know; newer builds treat a missing field as its documented default.
- **Breaking changes bump the version.** Renaming or removing a field, changing a field's meaning or type, or making a field required. The parser then migrates older files forward before validating, so every older file still imports.
- A file with a version above the build's is refused with "update the app first".
- `src/lib/utils/fixtures/backup-v1.json` is a version-1 file written by the exporter as it shipped in v0.4.2 and v0.4.3 (exported from develop at f2f36e8). It is frozen; a test imports it with the current parser.

## What is in it, and what is not

The rule: user-authored and irreplaceable goes in; caches, view state and device state stay out.

| Data | Where it lives | In the backup |
|---|---|---|
| Annotations (notes, highlights, themes, bookmarks) | `annotations` table | yes |
| Tags | `tags` table | yes |
| Saved searches | `savedSearches` table | yes |
| Preferences, including the reading position | `settings` table | yes |
| Scratch pad | `kv` `scratchPad` | yes |
| Split-pane layout | `kv` `splitPanes` (formerly `localStorage` `codex:splitPanes`) | no, view state |
| Navigation history | `kv` `navHistory`, cleared on tab close | no, view state |
| Translations the user asked for | `kv` `wantedTranslations` | no, device state; they download again |
| Installed datasets and resources | `datasets`, `resources` and the corpus tables | no, they download again |
| Search indexes | `searchIndexes` | no, a cache, rebuilt |
| What's New seen | `kv` `whatsNewSeen` | no, device state |
| Last export time | `kv` `lastBackupExport` | no, device state |

## Import

**Merge** is last-write-wins per record. For each backup record:

| This browser has | Result |
|---|---|
| no record with that id | the backup's is added |
| an older copy | the backup's overwrites it |
| a newer copy | the local one is kept |
| the same timestamp | nothing is written |

Local records the backup does not have are kept. Settings stay as they are. The scratch pad follows the same rule as a record, and on a tie an empty local pad takes the backup's.

**Replace** makes the backup the whole truth: the annotation, tag and saved search tables are cleared and the backup written, and its settings and scratch pad replace the local ones. A file without a scratch pad section (written before it existed) leaves the local pad alone.

Both modes read local records, plan and write inside one read-write transaction, so nothing changes between the decision and the write, and a failure part way leaves the database as it was. The preview shown before importing runs the same plan on a separate read.

**Deletions do not travel.** There are no deletion records (tombstones) yet: a record deleted here comes back if a backup that still holds it is merged. Tombstones are part of sync (#59, #62).
