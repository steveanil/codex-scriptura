// @codex-scriptura/core — public API
export type {
    VerseRecord,
    Translation,
    Annotation,
    AnnotationType,
    Tag,
    BibleReference,
    UserSettings,
    Testament,
    BookMeta,
    SavedSearch,
} from './types.js';

export { BOOKS, OT_BOOKS, NT_BOOKS, AP_BOOKS, findBook } from './books.js';
export { resolveBook, parseReference, formatReference, toOsisId } from './refs.js';
