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

export type UserSettings = {
    id: string;
    activeTranslation: string;
    parallelTranslation?: string;
    theme: 'light' | 'dark' | 'system';
    fontSize: number;
    readerLayout: 'single' | 'parallel';
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
