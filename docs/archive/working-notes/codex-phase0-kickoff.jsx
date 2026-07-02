import { useState, useEffect } from "react";

const STEPS = [
  {
    id: "decisions",
    title: "Week 0 — Decisions Before Code",
    subtitle: "Make these calls now so you're not refactoring in month 2",
    tasks: [
      {
        id: "d1",
        title: "Pick your framework: SolidJS or Svelte 5",
        detail: `Both are great. Here's your deciding question: Do you want JSX familiarity (SolidJS) or the most approachable contributor onboarding (Svelte)? If you're building this solo or with 1 other dev and want raw performance, go Solid. If you want community contributions faster, go Svelte — its syntax is easier for newcomers.\n\nMy recommendation: Svelte 5 with runes. The new reactivity model is powerful, the ecosystem is mature, and SvelteKit gives you routing and SSR for free if you ever need it.`,
        action: "Run: npm create svelte@latest codex",
      },
      {
        id: "d2",
        title: "Choose your Bible text format",
        detail: `You need a pipeline: Source Format → Internal JSON → IndexedDB. Your two real options:\n\n• OSIS XML — the scholarly standard. Well-structured, supports footnotes, cross-refs, and markup. Most open Bible texts ship as OSIS.\n• USFM — the translation standard. Used by unfoldingWord and Paratext. Simpler but less metadata.\n\nRecommendation: Accept OSIS as import format, convert to a custom lean JSON schema for storage. You don't want to parse XML at runtime.`,
        action:
          "Design your internal verse JSON schema (see below in the doc)",
      },
      {
        id: "d3",
        title: "Pick your initial Bible texts (2–3 max)",
        detail: `Start with texts that are free, well-tagged, and cover your needs:\n\n1. World English Bible (WEB) — public domain, modern English, OSIS available\n2. Berean Standard Bible (BSB) — public domain, modern, good for devotional use\n3. SBLGNT — Greek NT with morphology (CC BY), this is your original-language foundation\n\nDo NOT start with ESV/NIV/NASB. They require licensing agreements. Add them as plugins later.`,
        action:
          "Download WEB OSIS XML from ebible.org and SBLGNT from morphgnt GitHub repo",
      },
      {
        id: "d4",
        title: "Set up your repo structure",
        detail: `Monorepo with clear boundaries. Use pnpm workspaces.\n\ncodex/\n├── apps/\n│   └── web/              → SvelteKit PWA (the main app)\n├── packages/\n│   ├── core/             → Text engine, verse refs, search\n│   ├── plugin-api/       → Plugin types and contracts\n│   ├── db/               → IndexedDB schema, Dexie wrapper\n│   └── data-pipeline/    → OSIS→JSON converter scripts\n├── plugins/\n│   └── example-plugin/   → Reference plugin implementation\n├── data/\n│   └── texts/            → Raw source texts (gitignored if large)\n├── pnpm-workspace.yaml\n└── turbo.json            → Turborepo for build orchestration`,
        action:
          "Run: mkdir codex && cd codex && pnpm init && set up workspace config",
      },
      {
        id: "d5",
        title: "Define your verse reference system",
        detail: `This is more important than it sounds. Every feature depends on addressing verses consistently. Use a canonical string format:\n\n"GEN.1.1" — book.chapter.verse (OSIS-style)\n"GEN.1.1-GEN.1.3" — ranges\n"GEN.1.1+ROM.8.28" — sets\n\nBuild a tiny utility library (parseRef, formatRef, compareRef, isInRange) and put it in packages/core. You'll use it everywhere.`,
        action: "Write the VerseRef type + parser as your very first code",
      },
    ],
  },
  {
    id: "data",
    title: "Week 1–2 — Data Pipeline",
    subtitle: "The unsexy work that makes everything else possible",
    tasks: [
      {
        id: "p1",
        title: "Build the OSIS → JSON converter",
        detail: `Write a Node script (in packages/data-pipeline) that:\n1. Reads OSIS XML\n2. Walks the tree, extracting book → chapter → verse\n3. Outputs one JSON file per book\n4. Preserves: verse text, footnotes, paragraph breaks\n5. Normalizes verse refs to your canonical format\n\nUse fast-xml-parser (not the DOM parser). Target output: ~4MB total for full WEB Bible in JSON.`,
        action: "pnpm add -D fast-xml-parser in data-pipeline package",
      },
      {
        id: "p2",
        title: "Design the IndexedDB schema",
        detail: `Use Dexie.js (IndexedDB wrapper). Schema v1:\n\n• translations: { id, name, language, version }\n• books: { id, translationId, osisId, name, order, chapterCount }\n• verses: { id, bookId, chapter, verse, text, [translationId+osisRef] }\n• annotations: { id, type, verseRef, content, color, createdAt, updatedAt }\n• settings: { key, value }\n\nIndex on [translationId+osisRef] for fast parallel lookups. Index annotations on verseRef.`,
        action: "pnpm add dexie in packages/db",
      },
      {
        id: "p3",
        title: "Write the Bible loader",
        detail: `On first app launch:\n1. Check if IndexedDB has data\n2. If not, fetch JSON files (from /static or a CDN)\n3. Bulk-insert into IndexedDB using Dexie bulkPut\n4. Show a progress bar ("Loading Bible text... 43/66 books")\n5. Subsequent launches skip this entirely\n\nThis should take < 5 seconds on a decent connection, < 2 seconds on subsequent loads (already cached by service worker).`,
        action: "Build this as a reusable initializeDatabase() function in packages/db",
      },
      {
        id: "p4",
        title: "Write the text access API",
        detail: `In packages/core, create the text engine:\n\ngetVerse(ref: string, translation?: string): Promise<Verse>\ngetChapter(book: string, chapter: number, translation?: string): Promise<Verse[]>\ngetBook(book: string): Promise<BookMetadata>\ngetTranslations(): Promise<Translation[]>\nsearchText(query: string, scope?: string): Promise<SearchResult[]>\n\nThis is the API that both the UI and plugins will use. Get it right now.`,
        action: "Build and unit test each function with vitest",
      },
    ],
  },
  {
    id: "reader",
    title: "Week 2–4 — The Bible Reader",
    subtitle: "The feature your users will spend 90% of their time in",
    tasks: [
      {
        id: "r1",
        title: "Build the reading pane component",
        detail: `This is your most important UI component. Requirements:\n\n• Render a full chapter as flowing text (not a table of verse numbers)\n• Verse numbers as subtle superscripts\n• Paragraph breaks preserved from source data\n• Click/tap a verse to select it (highlight + action bar appears)\n• Keyboard navigation: ↑↓ for verse, ←→ for chapter\n• Smooth chapter transitions\n• Virtualized rendering if chapters are long (Psalms 119 = 176 verses)\n\nSpend real time on typography. Use a proper serif reading font (Literata, Source Serif 4, or Noto Serif). Line height 1.6–1.8. Max width 65ch.`,
        action: "Build ReadingPane.svelte as the first real UI component",
      },
      {
        id: "r2",
        title: "Build the navigation system",
        detail: `Three-level picker: Book → Chapter → (verse scroll)\n\n• Book grid grouped by OT/NT (or Pentateuch/History/Wisdom/Prophets/Gospels/Letters/Apocalyptic)\n• Chapter number grid\n• URL-based routing: /read/GEN/1, /read/ROM/8\n• Back/forward browser navigation must work\n• "Recently read" list in a dropdown\n• Keyboard shortcut to open quick-nav (Ctrl+K or Cmd+K, like VS Code)`,
        action: "Build BookChapterNav.svelte + wire up SvelteKit routes",
      },
      {
        id: "r3",
        title: "Build parallel view",
        detail: `Side-by-side translations. Start with 2-column.\n\n• Verses must align vertically (this is the hard part)\n• Use CSS Grid with each verse as a row, each translation as a column\n• Scroll is synced between columns\n• User can pick which translation goes in each column\n• On mobile: swipe between translations instead of side-by-side\n\nThe verse-alignment problem: verses sometimes span different amounts of text. Use a grid where each row is max-height of its cells.`,
        action: "Build ParallelView.svelte",
      },
      {
        id: "r4",
        title: "Build the annotation layer (highlights + notes)",
        detail: `When a verse is selected, show a floating toolbar:\n• 5 highlight colors (pick, don't over-design)\n• "Add note" button → opens a note editor panel\n• Notes are Markdown (use a lightweight MD editor, not a full WYSIWYG)\n• Highlights persist in IndexedDB immediately\n• Notes show as small icons next to the verse\n• A "My Notes" panel lists all annotations, filterable and searchable\n\nData model: { id, verseRef, type: 'highlight'|'note', color?, content?, tags[], createdAt }`,
        action: "Build AnnotationToolbar.svelte + NotesPanel.svelte",
      },
      {
        id: "r5",
        title: "Implement full-text search",
        detail: `Use MiniSearch (client-side, works offline).\n\n• Index all verses on first load (add to the initialization pipeline)\n• Search box in the top bar (Ctrl+F / Cmd+F)\n• Results show verse ref + text snippet with highlighted match\n• Filter by book, testament, or genre\n• Debounced input (300ms) for live results\n• Show result count and load results progressively\n\nMiniSearch is ~7KB gzipped and handles 30,000+ verses well.`,
        action: "pnpm add minisearch → build SearchBar.svelte + SearchResults.svelte",
      },
    ],
  },
  {
    id: "pwa",
    title: "Week 4–5 — PWA & Offline",
    subtitle: "Make it installable and bulletproof offline",
    tasks: [
      {
        id: "w1",
        title: "Configure the service worker",
        detail: `SvelteKit has built-in service worker support, or use Workbox.\n\n• Precache: app shell (HTML, CSS, JS bundles)\n• Runtime cache: Bible text JSON files (cache-first strategy)\n• IndexedDB data is already offline by nature\n• Add a "Update available" toast when new version is deployed\n\nTest by going to DevTools → Application → Service Workers → Offline checkbox.`,
        action: "Configure in svelte.config.js or add vite-plugin-pwa",
      },
      {
        id: "w2",
        title: "Add the Web App Manifest",
        detail: `manifest.json with:\n• name, short_name, description\n• Icons at 192px and 512px (design a simple icon — a codex/book symbol)\n• theme_color and background_color\n• display: "standalone"\n• start_url: "/"\n\nThis makes it installable on Android, desktop Chrome, Edge, and Safari (iOS has partial support).`,
        action: "Create static/manifest.json + link in app.html",
      },
      {
        id: "w3",
        title: "Test the full offline experience",
        detail: `Run through this checklist with network disabled:\n\n□ App loads from cache\n□ Can navigate books and chapters\n□ Can search verses\n□ Can add highlights and notes\n□ Parallel view works\n□ Notes persist after closing and reopening\n□ No console errors about failed network requests\n\nIf anything fails offline, fix it before moving on.`,
        action: "Create a test script that validates each offline scenario",
      },
    ],
  },
  {
    id: "plugins",
    title: "Week 5–7 — Plugin Architecture v1",
    subtitle: "The most important long-term investment in Phase 0",
    tasks: [
      {
        id: "x1",
        title: "Design the plugin manifest format",
        detail: `Every plugin needs a codex-plugin.json:\n\n{\n  "id": "org.example.my-plugin",\n  "name": "My Plugin",\n  "version": "1.0.0",\n  "description": "Does a thing",\n  "author": "Name",\n  "permissions": ["read:text", "read:annotations", "write:annotations", "ui:sidePanel"],\n  "entrypoint": "index.js",\n  "ui": {\n    "sidePanel": { "title": "My Panel", "icon": "book" },\n    "verseDecorator": true,\n    "contextMenu": [{ "label": "Do thing", "action": "doThing" }]\n  }\n}\n\nPermissions are key — plugins must declare what they need, users approve.`,
        action: "Define the PluginManifest TypeScript type in packages/plugin-api",
      },
      {
        id: "x2",
        title: "Build the plugin sandbox",
        detail: `Plugins run in Web Workers (or iframes for UI-heavy plugins).\n\n• Main app sends messages to plugin worker via postMessage\n• Plugin worker can call API methods by sending message requests back\n• Main app proxies these through the plugin API (checks permissions first)\n• Plugin UI components render in sandboxed iframes with message passing\n\nThis is the hardest part of Phase 0. Keep v1 simple:\n• Side panel slot (plugin renders HTML in an iframe)\n• Verse decorator (plugin returns extra HTML/text to append to a verse)\n• Context menu items (plugin registers actions on right-click)`,
        action: "Build PluginHost.ts (main thread) + PluginWorker.ts (worker thread)",
      },
      {
        id: "x3",
        title: "Build an example plugin",
        detail: `Create a "Verse of the Day" plugin that:\n1. Picks a random verse\n2. Displays it in a side panel\n3. Uses the text API to fetch it\n4. Has a "Refresh" button\n\nThis is your proof that the plugin API works. It also becomes the template every plugin author copies.\n\nThen build a second plugin: "Daily Reading Plan" that shows today's reading from a JSON schedule and marks chapters as read. This tests write:annotations permission.`,
        action: "Build in plugins/example-votd/ and plugins/example-reading-plan/",
      },
      {
        id: "x4",
        title: "Write plugin developer docs",
        detail: `If nobody can build plugins, the ecosystem never starts. Write:\n\n1. Getting Started guide (scaffold a plugin in 5 minutes)\n2. API Reference (every method, with examples)\n3. Permissions guide (what each permission grants)\n4. UI Extension Points (how to render in each slot)\n5. A plugin template repo on GitHub\n\nThis is as important as the code.`,
        action: "Create docs/ folder with Markdown guides, publish to GitHub Pages",
      },
    ],
  },
  {
    id: "ship",
    title: "Week 8 — Polish & Ship",
    subtitle: "Get it in front of real users",
    tasks: [
      {
        id: "s1",
        title: "Design polish pass",
        detail: `Spend 2–3 days on:\n• Consistent spacing and typography scale\n• Dark mode (CSS variables make this easy)\n• Loading states (skeleton screens, not spinners)\n• Keyboard shortcuts overlay (press ? to see all shortcuts)\n• Empty states ("No notes yet — highlight a verse to start")\n• Error states (graceful fallbacks, never a blank screen)\n• Touch targets ≥ 44px on mobile`,
        action: "Audit every screen with fresh eyes, fix the rough edges",
      },
      {
        id: "s2",
        title: "Performance audit",
        detail: `Run Lighthouse. Target:\n• Performance: > 90\n• PWA: > 90\n• Accessibility: > 85\n• Bundle size: < 200KB JS (gzipped, before Bible data)\n• Time to interactive: < 2s on 3G\n\nProfile chapter navigation — should feel instant (< 100ms). If it doesn't, you're either re-rendering too much or your IndexedDB queries need better indexes.`,
        action: "Run Lighthouse, fix top 3 issues, re-run until scores are green",
      },
      {
        id: "s3",
        title: "Deploy",
        detail: `Options (all free for this scale):\n• Vercel — best SvelteKit support, automatic deploys from GitHub\n• Cloudflare Pages — fast global CDN, generous free tier\n• Netlify — solid alternative\n\nSet up:\n• GitHub Actions CI (lint + test on every PR)\n• Auto-deploy main branch to production\n• Preview deploys for PRs\n\nBuy a domain. codex.bible would be ideal if available, otherwise try getcodex.app, codexbible.org, etc.`,
        action: "Connect GitHub repo to Vercel/Cloudflare, deploy, test the live URL",
      },
      {
        id: "s4",
        title: "Get your first 10 users",
        detail: `Don't launch broadly yet. Find:\n• 3 seminary students (your power users)\n• 2 pastors (your weekly-use case)\n• 2 developers (potential plugin authors)\n• 3 general Bible readers (your accessibility check)\n\nAsk them to use it for one week as their primary Bible reader. Collect feedback via a simple form or Discord channel. The feedback from this group shapes Phase 1 priorities.\n\nPost to: r/Reformed, r/AcademicBiblical, r/Christianity, Hacker News (Show HN), and Biblical language study Discord servers.`,
        action: "Create a feedback form + Discord server, recruit testers",
      },
    ],
  },
];

const COMMANDS_QUICKSTART = `# One-shot project setup (run these in order)

# 1. Create project
pnpm create svelte@latest codex -- --template skeleton --types ts
cd codex

# 2. Initialize monorepo
mkdir -p packages/core packages/db packages/plugin-api packages/data-pipeline
mkdir -p plugins/example-votd
mkdir -p data/texts

# 3. Install core deps
pnpm add dexie minisearch
pnpm add -D vitest @testing-library/svelte
pnpm add -D fast-xml-parser  # for data pipeline

# 4. Download your first Bible text
curl -o data/texts/web.zip https://ebible.org/Scriptures/eng-web_osis.zip
unzip data/texts/web.zip -d data/texts/web/

# 5. Start dev server
pnpm dev`;

const SCHEMA_EXAMPLE = `// packages/core/src/types.ts

export interface VerseRef {
  book: string;      // "GEN", "ROM", "REV"
  chapter: number;
  verse: number;
}

export interface Verse {
  ref: VerseRef;
  text: string;
  translationId: string;
  paragraphStart?: boolean;
  footnotes?: Footnote[];
}

export interface Annotation {
  id: string;
  verseRef: string;        // "GEN.1.1"
  type: 'highlight' | 'note' | 'bookmark';
  color?: string;
  content?: string;        // Markdown for notes
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// packages/db/src/schema.ts
import Dexie from 'dexie';

export class CodexDB extends Dexie {
  verses!: Table<VerseRow>;
  annotations!: Table<AnnotationRow>;
  translations!: Table<TranslationRow>;
  settings!: Table<SettingRow>;

  constructor() {
    super('codex');
    this.version(1).stores({
      translations: 'id, language',
      verses: 'id, [translationId+book+chapter+verse], [translationId+book+chapter]',
      annotations: 'id, verseRef, type, *tags, createdAt',
      settings: 'key'
    });
  }
}`;

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease",
      }}
    >
      <path
        d="M7 5L12 9L7 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 4V2.5A1.5 1.5 0 008.5 1H2.5A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function TaskItem({ task, checked, onToggle }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        borderLeft: checked
          ? "3px solid var(--accent)"
          : "3px solid var(--border)",
        marginBottom: 2,
        transition: "border-color 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 14px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          style={{
            width: 22,
            height: 22,
            minWidth: 22,
            borderRadius: 4,
            border: checked
              ? "2px solid var(--accent)"
              : "2px solid var(--muted)",
            background: checked ? "var(--accent)" : "transparent",
            color: checked ? "#fff" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            marginTop: 1,
            transition: "all 0.15s ease",
          }}
        >
          <CheckIcon />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 15,
              fontWeight: 600,
              color: checked ? "var(--muted)" : "var(--fg)",
              textDecoration: checked ? "line-through" : "none",
              lineHeight: 1.4,
            }}
          >
            {task.title}
          </div>
        </div>
        <div style={{ color: "var(--muted)", marginTop: 2 }}>
          <ChevronIcon open={expanded} />
        </div>
      </div>
      {expanded && (
        <div
          style={{
            padding: "0 14px 14px 46px",
            animation: "fadeIn 0.15s ease",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--fg-secondary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {task.detail}
          </div>
          {task.action && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "var(--surface-raised)",
                borderRadius: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ opacity: 0.5 }}>→</span>
              {task.action}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ code, title }) {
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 14px",
          background: "var(--surface-raised)",
          borderRadius: "8px 8px 0 0",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--muted)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          style={{
            background: "none",
            border: "none",
            color: copied ? "var(--accent)" : "var(--muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          <CopyIcon />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 14,
          background: "var(--surface-code)",
          borderRadius: "0 0 8px 8px",
          overflow: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--fg-secondary)",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

export default function Phase0Kickoff() {
  const [checked, setChecked] = useState({});
  const [activeSection, setActiveSection] = useState("decisions");
  const [tab, setTab] = useState("tasks");

  const totalTasks = STEPS.reduce((sum, s) => sum + s.tasks.length, 0);
  const completedTasks = Object.values(checked).filter(Boolean).length;
  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const toggleCheck = (taskId) => {
    setChecked((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  return (
    <div
      style={{
        fontFamily: "var(--font-body)",
        color: "var(--fg)",
        maxWidth: 800,
        margin: "0 auto",
        padding: "24px 16px",
        "--accent": "#B45309",
        "--accent-soft": "#B4530915",
        "--fg": "#1a1a1a",
        "--fg-secondary": "#4a4a4a",
        "--muted": "#999",
        "--bg": "transparent",
        "--surface": "#fff",
        "--surface-raised": "#f5f3f0",
        "--surface-code": "#faf8f5",
        "--border": "#e5e0da",
        "--font-body": "'Source Serif 4', 'Georgia', serif",
        "--font-mono": "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-color-scheme: dark) {
          :root {
            --fg: #e5e0da;
            --fg-secondary: #b0a898;
            --muted: #6b6560;
            --surface: #1a1816;
            --surface-raised: #252220;
            --surface-code: #1e1c1a;
            --border: #333028;
            --accent: #D97706;
            --accent-soft: #D9770620;
          }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--accent)",
            marginBottom: 8,
            fontWeight: 600,
          }}
        >
          Codex Bible Platform
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 6px 0",
            lineHeight: 1.2,
          }}
        >
          Phase 0 — Kickoff Guide
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--fg-secondary)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          8 weeks to a working Bible reader with offline support, parallel
          translations, annotations, search, and a plugin system.
        </p>
      </div>

      {/* Progress */}
      <div
        style={{
          marginBottom: 28,
          padding: 16,
          background: "var(--surface-raised)",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {completedTasks} / {totalTasks} tasks
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            {Math.round(progress)}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: "var(--border)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "var(--accent)",
              borderRadius: 3,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          marginBottom: 24,
          borderBottom: "2px solid var(--border)",
        }}
      >
        {[
          { id: "tasks", label: "Task Checklist" },
          { id: "quickstart", label: "Quick Start" },
          { id: "schema", label: "Schema & Types" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 18px",
              border: "none",
              background: "none",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              color: tab === t.id ? "var(--accent)" : "var(--muted)",
              borderBottom:
                tab === t.id
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              marginBottom: -2,
              transition: "color 0.15s ease",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "tasks" && (
        <div>
          {/* Section nav */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 20,
            }}
          >
            {STEPS.map((step) => {
              const sectionDone = step.tasks.every((t) => checked[t.id]);
              const sectionPartial = step.tasks.some((t) => checked[t.id]);
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveSection(step.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border:
                      activeSection === step.id
                        ? "1.5px solid var(--accent)"
                        : "1.5px solid var(--border)",
                    background:
                      activeSection === step.id
                        ? "var(--accent-soft)"
                        : "transparent",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    color:
                      sectionDone
                        ? "var(--accent)"
                        : activeSection === step.id
                        ? "var(--accent)"
                        : "var(--fg-secondary)",
                    textDecoration: sectionDone ? "none" : "none",
                    opacity: sectionDone ? 0.6 : 1,
                  }}
                >
                  {sectionDone ? "✓ " : sectionPartial ? "◐ " : ""}
                  {step.title.split("—")[0].trim()}
                </button>
              );
            })}
          </div>

          {/* Active section */}
          {STEPS.filter((s) => s.id === activeSection).map((step) => (
            <div key={step.id}>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  margin: "0 0 4px 0",
                }}
              >
                {step.title}
              </h2>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--fg-secondary)",
                  margin: "0 0 16px 0",
                  fontStyle: "italic",
                }}
              >
                {step.subtitle}
              </p>
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {step.tasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    checked={!!checked[task.id]}
                    onToggle={() => toggleCheck(task.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "quickstart" && (
        <div>
          <p
            style={{
              fontSize: 15,
              color: "var(--fg-secondary)",
              lineHeight: 1.6,
              marginTop: 0,
              marginBottom: 20,
            }}
          >
            Copy-paste this into your terminal to scaffold the project. You'll
            have a running dev server in under 5 minutes.
          </p>
          <CodeBlock code={COMMANDS_QUICKSTART} title="Terminal — Project Setup" />
          <div
            style={{
              padding: 14,
              background: "var(--accent-soft)",
              borderRadius: 8,
              borderLeft: "3px solid var(--accent)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--fg-secondary)",
            }}
          >
            <strong style={{ color: "var(--accent)" }}>After setup:</strong>{" "}
            Your first code should be the VerseRef parser in
            packages/core/src/verse-ref.ts. Everything else depends on it. Write
            it, test it, then move to the data pipeline.
          </div>
        </div>
      )}

      {tab === "schema" && (
        <div>
          <p
            style={{
              fontSize: 15,
              color: "var(--fg-secondary)",
              lineHeight: 1.6,
              marginTop: 0,
              marginBottom: 20,
            }}
          >
            Core TypeScript types and the Dexie database schema. Copy this into
            your project as a starting point.
          </p>
          <CodeBlock code={SCHEMA_EXAMPLE} title="Core Types & DB Schema" />
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          marginTop: 32,
          padding: "16px 0",
          borderTop: "1px solid var(--border)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          textAlign: "center",
        }}
      >
        Codex Phase 0 — Target: 8 weeks from first commit to first users
      </div>
    </div>
  );
}
