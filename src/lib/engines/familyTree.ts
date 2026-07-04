/**
 * Family tree engine — data-driven genealogy for any person.
 *
 * Builds parent/child lookup maps from the seeded `relationships` table
 * (father-of / mother-of edges run parent → child) and lays out the tidy
 * generational tree used by the genealogy modal. Unlike the static Genesis-10
 * Table of Nations, this covers every person with recorded family links
 * (~1,700 people).
 */

import type { Relationship } from '@codex-scriptura/core';
import { db } from '@codex-scriptura/db';

export type FamilyGraph = {
    /** parent id → child ids (father-of and mother-of edges merged, deduped) */
    children: Map<string, string[]>;
    /** child id → primary parent id (father preferred over mother) */
    parentOf: Map<string, string>;
    /** child id → father id (first father-of edge wins) */
    fatherOf: Map<string, string>;
    /** child id → mother id (first mother-of edge wins) */
    motherOf: Map<string, string>;
    /** person id → display name */
    names: Map<string, string>;
};

/**
 * Which parent to prefer at each hop of an ancestry walk. Where only one
 * parent is recorded the walk continues through them either way — the choice
 * only matters for people with both parents on record (e.g. Jesus, whose
 * father's side follows Matthew 1 through Joseph and mother's side follows
 * Luke 3 through Mary and Heli).
 */
export type LineagePreference = 'paternal' | 'maternal';

/** "mahalalel_1893" → "Mahalalel" — fallback when a person record is missing. */
export function nameFromId(id: string): string {
    return id
        .replace(/_\d+$/, '')
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/** Pure graph construction from relationship edges — testable without Dexie. */
export function buildFamilyGraph(
    relationships: Relationship[],
    names?: Iterable<[string, string]>,
): FamilyGraph {
    const children = new Map<string, string[]>();
    const parentOf = new Map<string, string>();
    const fatherOf = new Map<string, string>();
    const motherOf = new Map<string, string>();
    const nameMap = new Map<string, string>(names);

    for (const rel of relationships) {
        const isFather = rel.type === 'father-of';
        if (!isFather && rel.type !== 'mother-of') continue;
        const kids = children.get(rel.personFrom) ?? [];
        if (!kids.includes(rel.personTo)) kids.push(rel.personTo);
        children.set(rel.personFrom, kids);
        // Both parents are tracked; first edge of each type wins (the importer
        // now guarantees at most one father and one mother per child, so this
        // is a defensive guard against bad data, not a disambiguation rule).
        const byType = isFather ? fatherOf : motherOf;
        if (!byType.has(rel.personTo)) byType.set(rel.personTo, rel.personFrom);
    }

    // Default breadcrumb lineage: father preferred over mother.
    for (const [child, mother] of motherOf) parentOf.set(child, mother);
    for (const [child, father] of fatherOf) parentOf.set(child, father);

    for (const rel of relationships) {
        for (const id of [rel.personFrom, rel.personTo]) {
            if (!nameMap.has(id)) nameMap.set(id, nameFromId(id));
        }
    }

    return { children, parentOf, fatherOf, motherOf, names: nameMap };
}

/** Load the full family graph from Dexie (~2.5K edges — cheap enough to read whole). */
export async function loadFamilyGraph(): Promise<FamilyGraph> {
    const relationships = await db.relationships.toArray();

    const ids = new Set<string>();
    for (const rel of relationships) {
        ids.add(rel.personFrom);
        ids.add(rel.personTo);
    }
    const idList = [...ids];
    const persons = await db.persons.bulkGet(idList);
    const names: [string, string][] = idList.map((id, i) => [id, persons[i]?.name ?? nameFromId(id)]);

    return buildFamilyGraph(relationships, names);
}

/**
 * Resolve what the caller handed us — a Theographic person id, or a display
 * name (e.g. from the Table-of-Nations lineage rail) — to a person id the
 * graph can root on. Ambiguous names pick the person with the most recorded
 * descendants. Returns undefined only when nothing matches.
 */
export async function resolveTreeRoot(graph: FamilyGraph, idOrName: string): Promise<string | undefined> {
    if (graph.names.has(idOrName)) return idOrName;

    // A real person id with no recorded relationships — show them alone
    const byId = await db.persons.get(idOrName);
    if (byId) {
        graph.names.set(byId.id, byId.name);
        return byId.id;
    }

    const wanted = idOrName.trim().toLowerCase();
    let best: string | undefined;
    let bestCount = -1;
    for (const [id, name] of graph.names) {
        if (name.toLowerCase() !== wanted) continue;
        const count = subtreeCount(graph, id);
        if (count > bestCount) {
            best = id;
            bestCount = count;
        }
    }
    if (best) return best;

    const byName = await db.persons.where('name').equalsIgnoreCase(idOrName.trim()).first();
    if (byName) {
        graph.names.set(byName.id, byName.name);
        return byName.id;
    }
    return undefined;
}

/** Number of descendants under a person (excluding the person). */
export function subtreeCount(graph: FamilyGraph, id: string): number {
    let n = 0;
    const seen = new Set<string>([id]);
    const walk = (x: string) => {
        for (const c of graph.children.get(x) ?? []) {
            if (seen.has(c)) continue; // guard against bad data cycles
            seen.add(c);
            n++;
            walk(c);
        }
    };
    walk(id);
    return n;
}

export type CrumbPerson = { id: string; name: string };

/**
 * Ancestor path from the earliest recorded ancestor down to (and including)
 * `id`. `line` picks which parent to follow when a person has both on record:
 * 'paternal' prefers the father at each hop, 'maternal' the mother. Either
 * walk falls through to the other parent when the preferred one is missing,
 * so both lines run the full recorded depth.
 */
export function ancestryPath(
    graph: FamilyGraph,
    id: string,
    line: LineagePreference = 'paternal',
): CrumbPerson[] {
    const [preferred, fallback] =
        line === 'maternal'
            ? [graph.motherOf, graph.fatherOf]
            : [graph.fatherOf, graph.motherOf];
    const path: CrumbPerson[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = id;
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        path.unshift({ id: cur, name: graph.names.get(cur) ?? nameFromId(cur) });
        cur = preferred.get(cur) ?? fallback.get(cur);
    }
    return path;
}

/** Whether both a father and a mother are on record — i.e. two traceable lines. */
export function hasBothLines(graph: FamilyGraph, id: string): boolean {
    return graph.fatherOf.has(id) && graph.motherOf.has(id);
}

// ─── Tidy generational layout ───────────────────────────────

export const ROOT_COLOR = '#e0a44a';

/** Cycled across the root's direct children; each sub-line inherits its color. */
export const BRANCH_PALETTE = [
    '#6d6cf0', // indigo
    '#d98a3d', // orange
    '#4fa6cf', // cyan
    '#7fb069', // green
    '#c76b98', // rose
    '#b8a13f', // olive
    '#5fb8a5', // teal
    '#a97fd8', // violet
];

export type TreeNode = {
    id: string;
    name: string;
    depth: number;
    color: string;
    x: number;
    y: number;
    /** direct children in the data (visible or not) */
    kids: number;
    /** descendants hidden past the depth cap (0 when fully expanded) */
    more: number;
    isRoot: boolean;
};

export type TreeEdge = { d: string; color: string };

export type TreeBranch = { id: string; name: string; color: string };

export type TreeLayout = {
    nodes: TreeNode[];
    edges: TreeEdge[];
    /** the root's direct children, for the legend */
    branches: TreeBranch[];
    width: number;
    height: number;
};

export const TREE_CARD_W = 152;
export const TREE_CARD_H = 34;
const TREE_COL_W = 238;
const TREE_ROW_H = 44;
const TREE_X0 = 78;
const TREE_Y0 = 54;

/**
 * Tidy generational layout: one column per generation, leaves stacked at
 * fixed row height, parents centered between their first and last visible
 * child. Connectors are orthogonal H-V-H elbows colored by the child branch.
 */
export function layoutTree(graph: FamilyGraph, rootId: string, generations: number): TreeLayout {
    const nodes: TreeNode[] = [];
    const seen = new Set<string>();
    let leaf = 0;

    const walk = (id: string, depth: number, color: string, branchIdx: number): number => {
        seen.add(id);
        const allKids = graph.children.get(id) ?? [];
        const node: TreeNode = {
            id,
            name: graph.names.get(id) ?? nameFromId(id),
            depth,
            color,
            x: TREE_X0 + depth * TREE_COL_W,
            y: 0,
            kids: allKids.length,
            more: 0,
            isRoot: depth === 0,
        };
        nodes.push(node);
        const ys: number[] = [];
        if (depth < generations) {
            let i = 0;
            for (const c of allKids) {
                // Re-check at visit time: a sibling's subtree may have already
                // placed this child (merged identities give some people two
                // recorded fathers), and the tree must stay a tree
                if (seen.has(c)) continue;
                const idx = depth === 0 ? i : branchIdx;
                ys.push(walk(c, depth + 1, BRANCH_PALETTE[idx % BRANCH_PALETTE.length], idx));
                i++;
            }
        }
        if (ys.length > 0) {
            node.y = (ys[0] + ys[ys.length - 1]) / 2;
        } else {
            node.y = TREE_Y0 + leaf++ * TREE_ROW_H;
            node.more = allKids.length ? subtreeCount(graph, id) : 0;
        }
        return node.y;
    };
    walk(rootId, 0, ROOT_COLOR, 0);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: TreeEdge[] = [];
    for (const n of nodes) {
        if (n.depth >= generations) continue;
        for (const cid of graph.children.get(n.id) ?? []) {
            const c = byId.get(cid);
            if (!c || c.depth !== n.depth + 1) continue;
            const x1 = n.x + TREE_CARD_W;
            const y1 = n.y + TREE_CARD_H / 2;
            const x2 = c.x;
            const y2 = c.y + TREE_CARD_H / 2;
            const mx = x1 + (x2 - x1) / 2;
            edges.push({
                d: `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`,
                color: c.color,
            });
        }
    }

    const branches: TreeBranch[] = (graph.children.get(rootId) ?? []).map((id, i) => ({
        id,
        name: graph.names.get(id) ?? nameFromId(id),
        color: BRANCH_PALETTE[i % BRANCH_PALETTE.length],
    }));

    const deepest = nodes.reduce((d, n) => Math.max(d, n.depth), 0);
    const width = Math.max(TREE_X0 + deepest * TREE_COL_W + TREE_CARD_W + 30, 520);
    const height = Math.max(TREE_Y0 + leaf * TREE_ROW_H + 20, 480);

    return { nodes, edges, branches, width, height };
}
