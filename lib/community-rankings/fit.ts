/**
 * Community rankings, step 2: a Bradley-Terry fit on the aggregated counts
 * (plan section 9.2, points 2, 4 and 6). PURE and deterministic.
 *
 * The MM algorithm (Hunter 2004): each player's strength is updated to
 *   p_i = W_i / sum_j ( n_ij / (p_i + p_j) )
 * where W_i is his summed winning weight and n_ij the summed weight of every
 * statement between i and j, in either direction.
 *
 * SHRINKAGE is pseudo-comparisons against a fixed virtual average player of
 * strength 1: every real player gets `shrinkage` wins and `shrinkage` losses
 * against it. A player seen on two boards cannot top the list on that small a
 * sample, because the virtual games pull him toward the middle.
 *
 * CONNECTIVITY. Bradley-Terry only orders players linked by some chain of
 * comparisons. Components are found by union-find over pairs with weight above
 * zero (the virtual player links nobody) and each is fitted and normalised on
 * its own, so two groups nobody ranked against each other are never given an
 * invented order between them.
 */

import { isDefender } from "@/lib/site";

export type FitOptions = {
  shrinkage: number;
  tolerance?: number;
  maxIterations?: number;
};

export type FitResult = {
  /** player id -> natural log strength (component log mean is 0) and group. */
  players: Map<string, { strength: number; group: string }>;
  /** Group names, largest component first. */
  groups: string[];
  /** Iterations used by the slowest component. */
  iterations: number;
};

const DEFAULT_TOLERANCE = 1e-8;
const DEFAULT_MAX_ITERATIONS = 500;
const MIN_STRENGTH = 1e-12;

export function fitBradleyTerry(
  wins: ReadonlyMap<string, ReadonlyMap<string, number>>,
  positions: ReadonlyMap<string, string>,
  opts: FitOptions,
): FitResult {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const s = Math.max(0, opts.shrinkage);

  // Index every player that appears in a positive-weight statement, sorted by
  // id so that nothing depends on Map insertion order.
  const idSet = new Set<string>();
  for (const [winner, row] of wins) {
    for (const [loser, w] of row) {
      if (w > 0 && winner !== loser) {
        idSet.add(winner);
        idSet.add(loser);
      }
    }
  }
  const ids = [...idSet].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;

  const winTotals = new Float64Array(n);
  const pairTotals = new Map<number, number>();
  for (const [winner, row] of wins) {
    for (const [loser, w] of row) {
      if (!(w > 0) || winner === loser) continue;
      const a = index.get(winner) as number;
      const b = index.get(loser) as number;
      winTotals[a] += w;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * n + hi;
      pairTotals.set(key, (pairTotals.get(key) ?? 0) + w);
    }
  }

  // Union-find over real pairs only.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const edgeKeys = [...pairTotals.keys()].sort((x, y) => x - y);
  for (const key of edgeKeys) {
    const ra = find(Math.floor(key / n));
    const rb = find(key % n);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }

  const membersByRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    const list = membersByRoot.get(r);
    if (list) list.push(i);
    else membersByRoot.set(r, [i]);
  }
  const edgesByRoot = new Map<number, Array<[number, number, number]>>();
  for (const key of edgeKeys) {
    const a = Math.floor(key / n);
    const b = key % n;
    const r = find(a);
    const list = edgesByRoot.get(r) ?? [];
    list.push([a, b, pairTotals.get(key) as number]);
    edgesByRoot.set(r, list);
  }

  // Largest component first; ties broken by the smallest player id (members
  // are in index order, so the first member is the smallest id).
  const components = [...membersByRoot.entries()]
    .map(([root, members]) => ({ root, members }))
    .sort((x, y) => y.members.length - x.members.length || x.members[0] - y.members[0]);

  const strength = new Float64Array(n).fill(1);
  let slowest = 0;
  for (const comp of components) {
    const edges = edgesByRoot.get(comp.root) ?? [];
    const used = fitComponent(comp.members, edges, winTotals, strength, s, tolerance, maxIterations);
    slowest = Math.max(slowest, used);
  }

  const used = new Map<string, number>();
  const groups: string[] = [];
  const players = new Map<string, { strength: number; group: string }>();
  for (const comp of components) {
    const base = groupBaseName(comp.members.map((i) => positions.get(ids[i]) ?? null));
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const group = count === 1 ? base : `${base}-${count}`;
    groups.push(group);

    let logSum = 0;
    for (const i of comp.members) logSum += Math.log(strength[i]);
    const logMean = logSum / comp.members.length;
    for (const i of comp.members) {
      players.set(ids[i], { strength: Math.log(strength[i]) - logMean, group });
    }
  }

  return { players, groups, iterations: slowest };
}

function fitComponent(
  members: readonly number[],
  edges: ReadonlyArray<[number, number, number]>,
  winTotals: Float64Array,
  p: Float64Array,
  s: number,
  tolerance: number,
  maxIterations: number,
): number {
  const denom = new Float64Array(p.length);
  const next = new Float64Array(p.length);
  for (let iter = 1; iter <= maxIterations; iter += 1) {
    for (const i of members) denom[i] = s > 0 ? (2 * s) / (p[i] + 1) : 0;
    for (const [a, b, w] of edges) {
      const share = w / (p[a] + p[b]);
      denom[a] += share;
      denom[b] += share;
    }
    for (const i of members) {
      const numerator = winTotals[i] + s;
      next[i] = denom[i] > 0 ? Math.max(MIN_STRENGTH, numerator / denom[i]) : p[i];
    }
    if (s === 0) {
      // No virtual anchor: the scale is free, so pin the geometric mean to 1
      // every iteration or the whole component drifts.
      let logSum = 0;
      for (const i of members) logSum += Math.log(next[i]);
      const scale = Math.exp(-logSum / members.length);
      for (const i of members) next[i] = Math.max(MIN_STRENGTH, next[i] * scale);
    }
    let maxChange = 0;
    for (const i of members) {
      const change = Math.abs(next[i] - p[i]) / p[i];
      if (change > maxChange) maxChange = change;
      p[i] = next[i];
    }
    if (maxChange < tolerance) return iter;
  }
  return maxIterations;
}

function groupBaseName(positions: ReadonlyArray<string | null>): string {
  let defenders = 0;
  for (const pos of positions) if (isDefender(pos)) defenders += 1;
  if (defenders === positions.length) return "defense";
  if (defenders === 0) return "offense";
  return "all";
}
