/**
 * Genesis 10 — the Table of Nations.
 *
 * Static genealogy dataset for the contextual lineage rail (reader).
 * ~70 people rooted at Noah, each tagged with the patriarchal branch it
 * descends from. The full genealogy tree modal is data-driven instead —
 * see $lib/engines/familyTree.
 */

export type Branch = 'J' | 'H' | 'S' | 'root';

export type PersonNode = {
    id: string;
    name: string;
    branch: Branch;
    children: string[];
};

// [name, branch, children]
const RAW: Record<string, [string, Branch, string[]]> = {
    noah: ['Noah', 'root', ['japheth', 'ham', 'shem']],

    japheth: ['Japheth', 'J', ['gomer', 'magog', 'madai', 'javan', 'tubal', 'meshech', 'tiras']],
    gomer: ['Gomer', 'J', ['ashkenaz', 'riphath', 'togarmah']],
    magog: ['Magog', 'J', []],
    madai: ['Madai', 'J', []],
    javan: ['Javan', 'J', ['elishah', 'tarshish', 'kittim', 'dodanim']],
    tubal: ['Tubal', 'J', []],
    meshech: ['Meshech', 'J', []],
    tiras: ['Tiras', 'J', []],
    ashkenaz: ['Ashkenaz', 'J', []],
    riphath: ['Riphath', 'J', []],
    togarmah: ['Togarmah', 'J', []],
    elishah: ['Elishah', 'J', []],
    tarshish: ['Tarshish', 'J', []],
    kittim: ['Kittim', 'J', []],
    dodanim: ['Dodanim', 'J', []],

    ham: ['Ham', 'H', ['cush', 'mizraim', 'put', 'canaan']],
    cush: ['Cush', 'H', ['seba', 'havilah', 'sabtah', 'raamah', 'sabtecha', 'nimrod']],
    mizraim: ['Mizraim', 'H', ['ludim', 'anamim', 'naphtuhim', 'pathrusim']],
    put: ['Put', 'H', []],
    canaan: ['Canaan', 'H', ['sidon', 'heth', 'jebusite', 'amorite', 'girgashite']],
    seba: ['Seba', 'H', []],
    havilah: ['Havilah', 'H', []],
    sabtah: ['Sabtah', 'H', []],
    raamah: ['Raamah', 'H', ['sheba', 'dedan']],
    sabtecha: ['Sabtecha', 'H', []],
    nimrod: ['Nimrod', 'H', []],
    ludim: ['Ludim', 'H', []],
    anamim: ['Anamim', 'H', []],
    naphtuhim: ['Naphtuhim', 'H', []],
    pathrusim: ['Pathrusim', 'H', []],
    sidon: ['Sidon', 'H', []],
    heth: ['Heth', 'H', []],
    jebusite: ['Jebusite', 'H', []],
    amorite: ['Amorite', 'H', []],
    girgashite: ['Girgashite', 'H', []],
    sheba: ['Sheba', 'H', []],
    dedan: ['Dedan', 'H', []],

    shem: ['Shem', 'S', ['elam', 'asshur', 'arphaxad', 'lud', 'aram']],
    elam: ['Elam', 'S', []],
    asshur: ['Asshur', 'S', []],
    lud: ['Lud', 'S', []],
    arphaxad: ['Arphaxad', 'S', ['salah']],
    salah: ['Salah', 'S', ['eber']],
    eber: ['Eber', 'S', ['peleg', 'joktan']],
    peleg: ['Peleg', 'S', []],
    joktan: ['Joktan', 'S', []],
    aram: ['Aram', 'S', ['uz', 'hul', 'gether', 'mash']],
    uz: ['Uz', 'S', []],
    hul: ['Hul', 'S', []],
    gether: ['Gether', 'S', []],
    mash: ['Mash', 'S', []],
};

/** id → person */
export const NATIONS: Readonly<Record<string, PersonNode>> = Object.fromEntries(
    Object.entries(RAW).map(([id, [name, branch, children]]) => [id, { id, name, branch, children }]),
);

/** child id → parent id (Noah has no entry) */
export const PARENT: Readonly<Record<string, string>> = (() => {
    const map: Record<string, string> = {};
    for (const p of Object.values(NATIONS)) {
        for (const c of p.children) map[c] = p.id;
    }
    return map;
})();

/** Alternate KJV spellings → person id (Gen 10 uses these forms) */
const SPELLING_ALIASES: Record<string, string> = {
    Phut: 'put',
    Sabtechah: 'sabtecha',
    Zidon: 'sidon',
};

/** lowercase display name (including KJV spelling variants) → id */
export const NAME_TO_ID: ReadonlyMap<string, string> = new Map([
    ...Object.values(NATIONS).map((p) => [p.name.toLowerCase(), p.id] as const),
    ...Object.entries(SPELLING_ALIASES).map(([alias, id]) => [alias.toLowerCase(), id] as const),
]);

/** Every name form that may appear in verse text, for building match regexes */
export const MATCHABLE_NAMES: readonly string[] = [
    ...Object.values(NATIONS).map((p) => p.name),
    ...Object.keys(SPELLING_ALIASES),
];

/**
 * Match a person display name — possibly carrying a disambiguating qualifier
 * like "Cush (son of Ham)" — to a Table-of-Nations id. When the qualifier
 * names a father, it must agree with the dataset, so same-named people from
 * other lines (e.g. "Sheba (son of Joktan)") don't mis-match.
 */
export function matchPersonName(displayName: string): string | undefined {
    const m = displayName.match(/^(.+?)\s*(?:\((.+)\))?\s*$/);
    if (!m) return undefined;
    const id = NAME_TO_ID.get(m[1].trim().toLowerCase());
    if (!id) return undefined;
    const father = m[2]?.match(/son of (.+)/i)?.[1]?.trim().toLowerCase();
    if (father) {
        const parent = PARENT[id] ? NATIONS[PARENT[id]] : undefined;
        if (parent?.name.toLowerCase() !== father) return undefined;
    }
    return id;
}

export const BRANCH_COLORS: Record<Branch, string> = {
    J: '#6d6cf0', // Japheth — indigo
    H: '#d98a3d', // Ham — orange
    S: '#4fa6cf', // Shem — cyan
    root: '#e0a44a', // Noah — gold
};

export function branchColor(branch: Branch): string {
    return BRANCH_COLORS[branch];
}

/** Number of descendants under a person (excluding the person). */
export function subtreeCount(id: string): number {
    let n = 0;
    const walk = (x: string) => {
        for (const c of NATIONS[x].children) {
            n++;
            walk(c);
        }
    };
    walk(id);
    return n;
}

/** Relationship of a descendant `depth` generations below the focused person. */
export function relationLabel(depth: number): string {
    switch (depth) {
        case 0: return 'focused';
        case 1: return 'son';
        case 2: return 'grandson';
        case 3: return 'great-grandson';
        default: return `${depth - 2}× great-grandson`;
    }
}

/** Ancestor path from Noah down to (and including) `id`. */
export function ancestryPath(id: string): PersonNode[] {
    const path: PersonNode[] = [];
    let cur: string | undefined = id;
    while (cur) {
        path.unshift(NATIONS[cur]);
        cur = PARENT[cur];
    }
    return path;
}

// ─── Contextual rail (indented tree, 2 generations) ────────

export type RailRow = {
    id: string;
    name: string;
    depth: number;
    branch: Branch;
    relation: string;
};

/**
 * Walk `rootId` down `maxDepth` generations for the rail's indented tree.
 * Children of the root take their own branch; deeper rows inherit it, so a
 * whole visible sub-line shares one dot color.
 */
export function buildRailRows(rootId: string, maxDepth = 2): RailRow[] {
    const rows: RailRow[] = [];
    const walk = (id: string, depth: number, branch: Branch) => {
        const p = NATIONS[id];
        const br = depth <= 1 ? p.branch : branch;
        rows.push({ id, name: p.name, depth, branch: br, relation: relationLabel(depth) });
        if (depth < maxDepth) for (const c of p.children) walk(c, depth + 1, br);
    };
    walk(rootId, 0, NATIONS[rootId].branch);
    return rows;
}

