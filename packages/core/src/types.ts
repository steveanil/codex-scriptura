// ─── Verse & Translation ───────────────────────────────────

export type VerseRecord = {
    /** Composite key: `${translationId}.${osisId}` e.g. "KJV.Gen.1.1" */
    id: string;
    translationId: string;
    book: string;
    chapter: number;
    verse: number;
    /** OSIS reference e.g. "Gen.1.1" */
    osisId: string;
    text: string;
    /**
     * Space-separated Strong's identifiers found in this verse, e.g. "H430 H1254 G2316".
     * Present only when the source translation was imported from a morphologically tagged
     * OSIS file containing <w lemma="strong:H430"> markup. Absent for plain-text sources
     * (KJV, OEB, WEB as currently ingested).
     */
    lemmas?: string;
};

export type Translation = {
    id: string;
    name: string;
    abbreviation: string;
    language: string;
    license: string;
    description: string;
    verseCount: number;
};

// ─── Annotations ───────────────────────────────────────────

export type AnnotationType = 'highlight' | 'note' | 'bookmark' | 'memorization';

export type Annotation = {
    id: string;
    type: AnnotationType;
    book: string;
    verseStart: string;
    verseEnd: string;
    /** Color hex for highlights, rich text for notes, etc. */
    data: string;
    color?: string;
    tags: string[];
    created: number;
    modified: number;
    synced: boolean;
};

export type Tag = {
    id: string;
    name: string;
    color: string;
};

// ─── Bible Reference ───────────────────────────────────────

export type BibleReference = {
    book: string;
    chapter: number;
    verse?: number;
    verseEnd?: number;
};

// ─── Settings ──────────────────────────────────────────────

export type Theme = 'light' | 'dark' | 'system';
export type AccentColor = string; // hex, e.g. "#3b82f6"

export type FontOptions = {
    ui: string;
    reader: string;
    greek: string;
    hebrew: string;
    size: number; // base size in px
};

export type ReaderOptions = {
    layout: 'single' | 'parallel';
    lineHeight: number;
    columnWidth: 'narrow' | 'medium' | 'wide';
    density: 'compact' | 'normal' | 'relaxed';
    showVerseNumbers: boolean;
    showRedLetters: boolean;
    /** When true, verses flow as inline prose paragraphs; when false, each verse is on its own line. */
    paragraphMode: boolean;
};

export type HighlightPreset = {
    id: string;
    name: string;
    color: string; // hex
};

export type UserPreferences = {
    id: string;
    activeTranslation: string;
    parallelTranslation?: string;
    theme: Theme;
    accentColor: AccentColor;
    fonts: FontOptions;
    reader: ReaderOptions;
    highlightPresets: HighlightPreset[];
    /** Words per minute for the "~N min read" chapter estimate (default 200). */
    readingSpeed?: number;
};

// ─── Saved Searches ────────────────────────────────────────

export type SavedSearch = {
    id: string;
    query: string;
    translationIds: string[];
    testamentFilter: 'all' | 'OT' | 'NT' | 'AP';
    created: number;
    mode?: 'fulltext' | 'concordance' | 'lexical';
    includeVariants?: boolean;
};

// ─── Word Study / Concordance Search ──────────────────────────

/**
 * Search mode for the search page.
 * - fulltext:    MiniSearch fuzzy/ranked full-text (existing behaviour)
 * - concordance: exhaustive exact-word scan — returns ALL matches in canonical order
 * - lexical:     future — lookup by Strong's / lemma once tagged source data is integrated
 */
export type ConcordanceSearchMode = 'fulltext' | 'concordance' | 'lexical';

/**
 * Structured query for a concordance search operation.
 * Carries all parameters needed to reproduce a search across sessions.
 */
export type ConcordanceSearchQuery = {
    mode: ConcordanceSearchMode;
    term: string;
    /** When true, match common English inflected forms (loved/loves/loving for "love"). */
    includeVariants: boolean;
    translationIds: string[];
    testamentFilter: 'all' | 'OT' | 'NT' | 'AP';
};

/**
 * A single lexical occurrence within a verse.
 * Records the exact surface form found and how many times it appears.
 */
export type LexicalMatch = {
    /** Actual word form found in the verse text (e.g. "loveth", "loved"). */
    surface: string;
    /** Number of times this surface form appears in this verse. */
    count: number;
};

/**
 * Result of a word study (concordance) search.
 * Pairs the verse record with per-verse lexical match metadata.
 */
export type ConcordanceSearchResult = {
    verse: VerseRecord;
    /** Distinct surface forms of the query term found in this verse. */
    matches: LexicalMatch[];
    /** Total occurrences of all matched forms combined. */
    hitCount: number;
};

// ─── Theographic Entities ──────────────────────────────────

export type Person = {
    /** Theographic person ID (e.g. "Moses", "P001"). */
    id: string;
    name: string;
    /** Gender code from Theographic data: "M", "F", or "U" (unknown). */
    gender?: string;
    /** OSIS verse IDs where this person appears (e.g. ["Gen.1.1", "Matt.1.1"]). */
    verseRefs: string[];
    description?: string;
    /** Hebrew or Greek etymology/meaning of the name, e.g. "father of a multitude". */
    nameMeaning?: string;
    /** Which dataset supplied the name meaning. */
    nameMeaningSource?: 'bibledata';
};

export type Place = {
    /** Theographic place ID. */
    id: string;
    name: string;
    lat?: number;
    lng?: number;
    /** Geocoding confidence 0–1, if provided by source data. */
    confidence?: number;
    /** OSIS verse IDs where this place appears. */
    verseRefs: string[];
    description?: string;
    /** Which dataset supplied the coordinates: 'theographic', 'openbible', or 'merged'. */
    source?: 'theographic' | 'openbible' | 'merged';
    /** OpenBible lookup ID, preserved for provenance when coordinates were sourced from OpenBible. */
    openBibleId?: string;
};

export type BibleEvent = {
    /** Theographic event ID. */
    id: string;
    name: string;
    /** Approximate date string, if available (e.g. "~1000 BC"). */
    date?: string;
    /** OSIS verse IDs where this event occurs. */
    verseRefs: string[];
    description?: string;
};

export type DictionaryEntry = {
    /** Lowercased, trimmed term — used as primary key. */
    id: string;
    /** Original display term. */
    term: string;
    definition: string;
};

// ─── Search Index Cache ───────────────────────────────────

export type SearchIndexCache = {
    /** Composite key: e.g. "minisearch:KJV" or "palette:KJV" */
    id: string;
    translationId: string;
    /** JSON.stringify'd MiniSearch index */
    serializedIndex: string;
    /** Number of verses when the index was built — used to detect staleness */
    verseCount: number;
    createdAt: number;
};

// ─── Book Metadata ─────────────────────────────────────────

export type Testament = 'OT' | 'NT' | 'AP';

export type BookMeta = {
    osisId: string;
    name: string;
    abbrev: string;
    testament: Testament;
    chapters: number;
};
