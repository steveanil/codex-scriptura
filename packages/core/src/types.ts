// ─── Source & Provenance ──────────────────────────────────
//
// Multi-source provenance model for tracking which datasets contributed
// to each record and field. See docs/data-architecture.md for the full spec.

/**
 * Data domains recognized by the source registry.
 * Each domain has its own merge precedence chain.
 */
export type SourceDomain =
    | 'persons'
    | 'places'
    | 'events'
    | 'dictionary'
    | 'relationships'
    | 'cross-references'
    | 'lexicon'
    | 'morphology'
    | 'text';

/**
 * A reference to a source dataset that contributed to a record.
 * Attached as `sources?: SourceRef[]` on entity types.
 *
 * Field-level provenance: `fields` lists which properties on the parent
 * record this source contributed. If a field exists on the record but no
 * SourceRef claims it, the field was derived (computed by pipeline logic).
 */
export type SourceRef = {
    /** Source dataset ID from the registry, e.g. 'theographic', 'bibledata' */
    sourceId: string;
    /** The record's identifier in the source dataset (for traceability) */
    externalId?: string;
    /** Which fields on the parent record this source contributed */
    fields: string[];
};

// ─── Conflict Model ──────────────────────────────────────
//
// When two sources disagree on a field value, the winning value
// (per domain precedence) goes on the entity record. The competing
// claim is stored in a ConflictRecord sidecar.

/**
 * A single source's assertion about a field value.
 */
export type ConflictClaim = {
    /** Source dataset ID */
    sourceId: string;
    /** The value this source asserts */
    value: unknown;
    /** Optional contextual note (e.g. "Matthew 1 lineage" vs "Luke 3 lineage") */
    note?: string;
};

/**
 * A record of competing claims on a single field of a single entity.
 * Stored in a sidecar table/file, not inline on the entity.
 * Claims are ordered by precedence (winner first).
 */
export type ConflictRecord = {
    /** Deterministic ID: `${entityType}:${entityId}:${field}` */
    id: string;
    /** Entity type: 'person', 'place', 'event', 'relationship', 'lexicon' */
    entityType: string;
    /** Canonical entity ID */
    entityId: string;
    /** Field name where the conflict exists */
    field: string;
    /** Claims from each source, ordered by precedence (winner first) */
    claims: ConflictClaim[];
};

// ─── Verse & Translation ───────────────────────────────────

export type VerseRecord = {
    /** Composite key: `${translationId}.${osisId}` e.g. "KJV.Gen.1.1" */
    id: string;
    translationId: string;
    book: string;
    chapter: number;
    verse: number;
    /**
     * Present when the source bridges multiple verses into one entry
     * (e.g. USFX <v id="15-16"/>). `verse` is the first verse of the bridge,
     * `verseEnd` the last; the combined text is stored once, on this record.
     */
    verseEnd?: number;
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
    /**
     * Words of Jesus markup. JSON-encoded array of [start, end] character offset pairs
     * indicating which portions of `text` are words of Jesus.
     * e.g. "[[0,45]]" means characters 0–44 are Jesus's words.
     * Present only for translations with <wj> markup (currently WEB only).
     */
    wj?: string;
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
    lastBook?: string;
    lastChapter?: number;
};

// ─── Saved Searches ────────────────────────────────────────

export type SavedSearch = {
    id: string;
    query: string;
    translationIds: string[];
    testamentFilter: 'all' | 'OT' | 'NT' | 'AP';
    created: number;
    mode?: 'fulltext' | 'concordance' | 'lexicon';
    includeVariants?: boolean;
};

// ─── Word Study / Concordance Search ──────────────────────────

/**
 * Search mode for the search page.
 * - fulltext:    MiniSearch fuzzy/ranked full-text (existing behaviour)
 * - concordance: exhaustive exact-word scan — returns ALL matches in canonical order
 * - lexicon:     lookup by Strong's / lemma from the seeded lexicon dataset
 */
export type ConcordanceSearchMode = 'fulltext' | 'concordance' | 'lexicon';

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
    /** Field-level provenance. See docs/data-architecture.md §4.2. */
    sources?: SourceRef[];
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
    /** Field-level provenance. See docs/data-architecture.md §4.2. */
    sources?: SourceRef[];
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
    /** Field-level provenance. See docs/data-architecture.md §4.2. */
    sources?: SourceRef[];
};

export type DictionaryEntry = {
    /** Lowercased, trimmed term — used as primary key. */
    id: string;
    /** Original display term. */
    term: string;
    definition: string;
};

// ─── Cross-References ─────────────────────────────────────

/**
 * Type of relationship between two cross-referenced passages.
 * - quotation:    Direct quotation (NT quoting OT)
 * - allusion:     Indirect reference or echo
 * - theme:        Shared thematic content
 * - keyword:      Shared significant keyword(s)
 * - parallel:     Synoptic or parallel account (e.g. Gospel parallels)
 * - unclassified: Relationship exists but type is not yet determined
 */
export type CrossReferenceType =
    | 'quotation'
    | 'allusion'
    | 'theme'
    | 'keyword'
    | 'parallel'
    | 'unclassified';

export type CrossReference = {
    /** Deterministic ID: `${sourceVerse}→${targetVerse}` */
    id: string;
    /** OSIS ID of the referring verse, e.g. "Matt.4.4" */
    sourceVerse: string;
    /** OSIS ID of the referred-to verse, e.g. "Deut.8.3" */
    targetVerse: string;
    /** Classification of the cross-reference relationship. */
    type: CrossReferenceType;
    /** Number of community votes (from OpenBible dataset). Higher = stronger signal. */
    votes: number;
    /** Field-level provenance. See docs/data-architecture.md §4.2. */
    sources?: SourceRef[];
};

// ─── Graph Primitives ─────────────────────────────────────

/**
 * The semantic class of a node in the scripture graph.
 * - verse:   A single OSIS verse (Gen.1.1)
 * - person:  A Theographic person entity
 * - place:   A Theographic place entity
 * - event:   A Theographic event entity
 * - book:    A canonical Bible book (Gen, Matt, …)
 * - chapter: A chapter within a book (Gen.1, Matt.5, …)
 */
export type GraphNodeType = 'verse' | 'person' | 'place' | 'event' | 'book' | 'chapter';

export type GraphNode = {
    /** Namespaced ID, e.g. "verse:Gen.1.1", "book:Gen", "person:moses_1". */
    id: string;
    type: GraphNodeType;
    /** Human-readable label for display (e.g. "Gen 1:1", "Moses"). */
    label: string;
    /** Original record from the source table, carried opaquely for renderer use. */
    data?: unknown;
};

/**
 * The broad category of a graph edge — determines which underlying dataset
 * the edge was derived from and whether it is stored or synthesized.
 *
 * - cross-reference: Stored in the Dexie `crossReferences` table (~340K rows).
 * - entity-mention:  Synthesized on demand from `person.verseRefs` / `place.verseRefs` /
 *                    `event.verseRefs` — never materialised as Dexie rows.
 * - genealogy:       Reserved for the future `relationships` table (v0.4.0+).
 */
export type GraphEdgeCategory = 'cross-reference' | 'entity-mention' | 'genealogy';

export type GraphEdge = {
    /** Deterministic edge ID, e.g. the CrossReference id "Gen.1.1→Jer.10.12". */
    id: string;
    /** Namespaced source node ID, e.g. "verse:Gen.1.1". */
    source: string;
    /** Namespaced target node ID, e.g. "verse:Jer.10.12". */
    target: string;
    category: GraphEdgeCategory;
    /**
     * Subtype within the category.
     * For cross-reference edges this is a CrossReferenceType string.
     * For entity-mention edges it will be the entity type ('person', 'place', 'event').
     */
    type: string;
    /** Relative strength signal — votes for cross-references, 1 for synthesized edges. */
    weight?: number;
};

// ─── Lexicon / Strong's ───────────────────────────────────

/**
 * A single entry in the Strong's Exhaustive Concordance lexicon.
 * Hebrew entries are sourced from BibleData/HebrewStrongs.csv.
 * Greek entries require a separate tagged source (not yet integrated).
 */
export type LexiconEntry = {
    /** Primary key: Strong's identifier, e.g. "H430" or "G2316" */
    id: string;
    /** Same as id — kept for explicit querying/display. */
    strongsNumber: string;
    language: 'hebrew' | 'greek';
    /** Original language word in Hebrew/Greek script. */
    lemma: string;
    /** Latin transliteration, e.g. "elohim" */
    transliteration: string;
    /** Short English gloss (first definition line). */
    gloss: string;
    /** Full entry text (transliteration header + all definitions). */
    description?: string;
    /** Field-level provenance. See docs/data-architecture.md §4.2. */
    sources?: SourceRef[];
};

// ─── Graph Engine Types ────────────────────────────────────

/**
 * Filters that constrain what the neighborhood engine returns.
 * All fields are optional — omitting a filter means "include everything."
 */
export type GraphFilters = {
    /** Limit to specific edge categories. Default: all categories. */
    edgeCategories?: GraphEdgeCategory[];
    /** Limit to specific edge subtypes (e.g. 'quotation', 'allusion'). Default: all. */
    edgeTypes?: string[];
    /** Hard cap on number of nodes in the result. Default: 120. */
    maxNodes?: number;
    /** Limit to specific node types in the result. Default: all. */
    nodeTypes?: GraphNodeType[];
};

/**
 * Result of a bounded neighborhood traversal.
 * Always includes the seed node even when the cap is exceeded on the first hop.
 */
export type NeighborhoodResult = {
    nodes: GraphNode[];
    edges: GraphEdge[];
    /** True when the hard node cap was hit and results were truncated. */
    truncated: boolean;
    /**
     * Approximate total available nodes (only set when truncated is true).
     * Not computed in Phase 3 — reserved for a future pass.
     */
    totalAvailable?: number;
};

/**
 * Book-to-book cross-reference density matrix.
 * Outer key: source book OSIS ID (e.g. "Gen").
 * Inner key: target book OSIS ID (e.g. "John").
 * Value: count of verse-level cross-references between those two books.
 */
export type BookConnectionMatrix = Map<string, Map<string, number>>;

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

// ─── Genealogy relationships ───────────────────────────────

export type RelationshipType =
    | 'father-of'
    | 'mother-of'
    | 'spouse-of'
    | 'sibling-of'
    | 'half-sibling-same-father'
    | 'ancestor-of';

export type Relationship = {
    /** Deterministic ID derived from members + relationship type */
    id: string;
    /** Theographic ID of the source person */
    personFrom: string;
    /** Theographic ID of the target person */
    personTo: string;
    /** Mapping union of edge-types */
    type: RelationshipType;
    /** Field-level provenance. See docs/data-architecture.md §4.2. */
    sources?: SourceRef[];
};
