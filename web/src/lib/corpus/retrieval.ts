import { corpus } from "@/lib/advisor/corpus";
import type { EdgeKind } from "@/lib/types";

export const ALL_EDGE_KINDS: EdgeKind[] = [
  "semantic_near",
  "semantic_dedup",
  "prerequisite_of",
  "specializes",
  "contrasts_with",
  "example_of",
  "same_phenomenon_different_frame",
];

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function l2norm(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

function centroid(vs: Float32Array[]): Float32Array {
  if (vs.length === 0) throw new Error("centroid of empty list");
  const d = vs[0].length;
  const acc = new Float32Array(d);
  for (const v of vs) for (let i = 0; i < d; i++) acc[i] += v[i];
  for (let i = 0; i < d; i++) acc[i] /= vs.length;
  return l2norm(acc);
}

/**
 * Maximal Marginal Relevance: rerank cosine top-K to favor diversity.
 * lambda=1 → pure relevance; lambda=0 → pure diversity. Default 0.5.
 *
 * Algorithm: pick a wider candidate window first, then iteratively select
 * the candidate maximizing  λ·sim(c, q) − (1−λ)·max_{c'∈selected} sim(c, c').
 */
export function mmr(
  query: Float32Array,
  k: number,
  lambda = 0.5,
  candidatePool = Math.min(corpus.embIds.length, k * 8),
): { id: number; score: number; relevance: number }[] {
  const candidates = corpus.cosineTopK(query, candidatePool);
  const selected: { id: number; score: number; relevance: number; emb: Float32Array }[] = [];
  const remaining = candidates.slice();

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const emb = corpus.embeddingForId(cand.id);
      if (!emb) continue;
      let maxSim = 0;
      for (const s of selected) {
        const sim = dot(emb, s.emb);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * cand.score - (1 - lambda) * maxSim;
      if (score > bestMmr) {
        bestMmr = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const picked = remaining.splice(bestIdx, 1)[0];
    const emb = corpus.embeddingForId(picked.id)!;
    selected.push({ id: picked.id, score: bestMmr, relevance: picked.score, emb });
  }

  return selected.map(({ id, score, relevance }) => ({ id, score, relevance }));
}

/**
 * Find concepts that "bridge" two seeds — i.e. score high on both endpoints
 * with a small gap between them. Useful for "what connects A to B?".
 *
 * Score per candidate c (excluding the two seeds):
 *   simA + simB − |simA − simB|
 *
 * This rewards candidates equally similar to both, penalizes lopsided ones.
 */
export function bridge(
  idA: number,
  idB: number,
  k: number,
): { id: number; score: number; simA: number; simB: number }[] {
  const a = corpus.embeddingForId(idA);
  const b = corpus.embeddingForId(idB);
  if (!a || !b) return [];
  const d = corpus.embDim;
  const n = corpus.embIds.length;
  const emb = corpus.embeddings;
  const out: { id: number; score: number; simA: number; simB: number }[] = [];
  for (let i = 0; i < n; i++) {
    const id = corpus.embIds[i];
    if (id === idA || id === idB) continue;
    let sa = 0;
    let sb = 0;
    const off = i * d;
    for (let j = 0; j < d; j++) {
      sa += emb[off + j] * a[j];
      sb += emb[off + j] * b[j];
    }
    const score = sa + sb - Math.abs(sa - sb);
    out.push({ id, score, simA: sa, simB: sb });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, k);
}

/**
 * Concepts near the centroid of multiple seed embeddings. Good for
 * "what's between/around these N ideas?".
 */
export function triangulate(
  ids: number[],
  k: number,
): { id: number; score: number }[] {
  const seeds: Float32Array[] = [];
  const seedSet = new Set(ids);
  for (const id of ids) {
    const e = corpus.embeddingForId(id);
    if (e) seeds.push(e);
  }
  if (seeds.length === 0) return [];
  const c = centroid(seeds);
  const wide = corpus.cosineTopK(c, k + ids.length);
  return wide.filter((h) => !seedSet.has(h.id)).slice(0, k);
}

/**
 * "Like X but in domain Y" — restrict candidate pool to concepts whose
 * `domain` includes the target, then rank by similarity to seed.
 *
 * If targetForm is also given, additionally require c.form === targetForm.
 */
export function analogy(
  seedId: number,
  opts: { domain?: string; form?: string; k: number },
): { id: number; score: number }[] {
  const seed = corpus.embeddingForId(seedId);
  if (!seed) return [];
  const d = corpus.embDim;
  const emb = corpus.embeddings;
  const out: { id: number; score: number }[] = [];
  for (let i = 0; i < corpus.embIds.length; i++) {
    const id = corpus.embIds[i];
    if (id === seedId) continue;
    const c = corpus.byId.get(id);
    if (!c) continue;
    if (opts.domain && !c.domain.includes(opts.domain)) continue;
    if (opts.form && c.form !== opts.form) continue;
    let s = 0;
    const off = i * d;
    for (let j = 0; j < d; j++) s += emb[off + j] * seed[j];
    out.push({ id, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.k);
}

/**
 * Lazily-built undirected weighted adjacency from corpus.edges. The export
 * step writes the graph keyed by src_id with kind → [{id, w}]; we union
 * incoming + outgoing per node, keeping the max weight when an edge appears
 * in both directions or under multiple kinds.
 */
type AdjEntry = { kinds: Set<EdgeKind>; w: number };
type Adj = Map<number, Map<number, AdjEntry>>;
let adjCache: Adj | null = null;
let adjCacheKinds: string | null = null;
let adjCacheEdges: unknown = null;

function buildAdj(kinds: Set<EdgeKind>): Adj {
  const adj: Adj = new Map();
  const upsert = (a: number, b: number, kind: EdgeKind, w: number) => {
    let m = adj.get(a);
    if (!m) {
      m = new Map();
      adj.set(a, m);
    }
    const e = m.get(b);
    if (e) {
      e.kinds.add(kind);
      if (w > e.w) e.w = w;
    } else {
      m.set(b, { kinds: new Set([kind]), w });
    }
  };
  for (const [srcStr, byKind] of Object.entries(corpus.edges)) {
    const src = Number(srcStr);
    for (const [kind, list] of Object.entries(byKind)) {
      if (!kinds.has(kind as EdgeKind)) continue;
      for (const e of list ?? []) {
        upsert(src, e.id, kind as EdgeKind, e.w);
        upsert(e.id, src, kind as EdgeKind, e.w);
      }
    }
  }
  return adj;
}

function getAdj(kinds: EdgeKind[]): Adj {
  const sorted = [...kinds].sort().join(",");
  // Invalidate when either the kinds filter or the edges object identity changes.
  // The latter matters in tests (corpus is reseeded) and could matter at runtime
  // if the corpus is ever reloaded without a process restart.
  if (adjCache && adjCacheKinds === sorted && adjCacheEdges === corpus.edges) {
    return adjCache;
  }
  adjCache = buildAdj(new Set(kinds));
  adjCacheKinds = sorted;
  adjCacheEdges = corpus.edges;
  return adjCache;
}

/**
 * Shortest weighted path from `from` to `to` over the edges graph.
 *
 * Each edge's traversal cost is 1 − w (higher-weight edges are cheaper),
 * so the path prefers strong connections. Restrict edge kinds via `kinds`.
 *
 * Returns the ordered chain of concept ids (inclusive), or null when no path
 * exists within `maxHops`. Each step also reports the weight and kinds of the
 * edge used.
 */
export function shortestPath(
  fromId: number,
  toId: number,
  opts: { kinds?: EdgeKind[]; maxHops?: number } = {},
): { ids: number[]; steps: { from: number; to: number; w: number; kinds: EdgeKind[] }[]; cost: number } | null {
  if (fromId === toId) return { ids: [fromId], steps: [], cost: 0 };
  const kinds = opts.kinds ?? ALL_EDGE_KINDS;
  const maxHops = opts.maxHops ?? 6;
  const adj = getAdj(kinds);
  if (!adj.has(fromId) || !adj.has(toId)) return null;

  // Dijkstra with hop cap. Distances small, so a linear-scan frontier is fine.
  const dist = new Map<number, number>([[fromId, 0]]);
  const hops = new Map<number, number>([[fromId, 0]]);
  const prev = new Map<number, { id: number; w: number; kinds: EdgeKind[] }>();
  const visited = new Set<number>();
  const frontier = new Set<number>([fromId]);

  while (frontier.size > 0) {
    let u = -1;
    let ud = Infinity;
    for (const n of frontier) {
      const d = dist.get(n)!;
      if (d < ud) {
        ud = d;
        u = n;
      }
    }
    if (u < 0) break;
    frontier.delete(u);
    visited.add(u);
    if (u === toId) break;
    const uh = hops.get(u)!;
    if (uh >= maxHops) continue;
    const neigh = adj.get(u);
    if (!neigh) continue;
    for (const [v, e] of neigh) {
      if (visited.has(v)) continue;
      const cost = ud + Math.max(0.001, 1 - e.w);
      if (cost < (dist.get(v) ?? Infinity)) {
        dist.set(v, cost);
        hops.set(v, uh + 1);
        prev.set(v, { id: u, w: e.w, kinds: [...e.kinds] });
        frontier.add(v);
      }
    }
  }

  if (!dist.has(toId)) return null;
  const ids: number[] = [];
  const steps: { from: number; to: number; w: number; kinds: EdgeKind[] }[] = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur);
    if (!p) return null;
    ids.push(cur);
    steps.push({ from: p.id, to: cur, w: p.w, kinds: p.kinds });
    cur = p.id;
  }
  ids.push(fromId);
  ids.reverse();
  steps.reverse();
  return { ids, steps, cost: dist.get(toId)! };
}

/**
 * Weighted random sample from the corpus, biased toward surprise/obscurity.
 *
 * weight(c) = (1 + surprise)^surpriseTemp · (1 + obscurity)^obscurityTemp
 *
 * Optionally anchored: when `anchorId` is set, restrict candidates to the
 * cosine top-`pool` neighbors of the anchor first, then weighted-sample.
 */
export function weightedSample(
  ids: number[],
  k: number,
  opts: { surpriseTemp?: number; obscurityTemp?: number } = {},
): number[] {
  const surpriseTemp = opts.surpriseTemp ?? 1;
  const obscurityTemp = opts.obscurityTemp ?? 0.5;
  const pool: { id: number; w: number }[] = [];
  for (const id of ids) {
    const c = corpus.byId.get(id);
    if (!c) continue;
    const w =
      Math.pow(1 + (c.surprise ?? 0), surpriseTemp) *
      Math.pow(1 + (c.obscurity ?? 0), obscurityTemp);
    if (w > 0) pool.push({ id, w });
  }
  // Sample k without replacement via the Efraimidis–Spirakis A-Res trick:
  // key = u^(1/w), keep the top-k keys.
  const keyed = pool.map((p) => ({ id: p.id, key: Math.pow(Math.random(), 1 / p.w) }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((x) => x.id);
}

/**
 * "Explain the connection" between two concepts: shared facets, direct
 * edges (in either direction), shared neighbors, and cosine similarity.
 *
 * Pure metadata — agents render the prose. Skips any LLM call.
 */
export function explain(
  idA: number,
  idB: number,
): {
  cosine: number | null;
  directEdges: { kind: EdgeKind; w: number; direction: "a_to_b" | "b_to_a" }[];
  sharedDomain: string[];
  sharedAffect: string[];
  sameForm: boolean;
  sameSource: boolean;
  sharedNeighbors: { id: number; via: EdgeKind[] }[];
} | null {
  const a = corpus.byId.get(idA);
  const b = corpus.byId.get(idB);
  if (!a || !b) return null;

  const ea = corpus.embeddingForId(idA);
  const eb = corpus.embeddingForId(idB);
  const cosine = ea && eb ? dot(ea, eb) : null;

  const directEdges: { kind: EdgeKind; w: number; direction: "a_to_b" | "b_to_a" }[] = [];
  const fromA = corpus.edges[String(idA)] ?? {};
  for (const [kind, list] of Object.entries(fromA)) {
    for (const e of list ?? []) {
      if (e.id === idB) directEdges.push({ kind: kind as EdgeKind, w: e.w, direction: "a_to_b" });
    }
  }
  const fromB = corpus.edges[String(idB)] ?? {};
  for (const [kind, list] of Object.entries(fromB)) {
    for (const e of list ?? []) {
      if (e.id === idA) directEdges.push({ kind: kind as EdgeKind, w: e.w, direction: "b_to_a" });
    }
  }

  const sharedDomain = a.domain.filter((d) => b.domain.includes(d));
  const sharedAffect = a.affect.filter((d) => b.affect.includes(d));
  const sameForm = a.form === b.form;
  const sameSource = a.source === b.source;

  // Shared neighbors across all edge kinds. For each candidate, record which
  // edge kind connected it to A and B (taking the union of kinds for each side).
  const aNeighbors = new Map<number, Set<EdgeKind>>();
  for (const [kind, list] of Object.entries(fromA)) {
    for (const e of list ?? []) {
      if (e.id === idB) continue;
      let s = aNeighbors.get(e.id);
      if (!s) {
        s = new Set();
        aNeighbors.set(e.id, s);
      }
      s.add(kind as EdgeKind);
    }
  }
  const sharedNeighbors: { id: number; via: EdgeKind[] }[] = [];
  for (const [kind, list] of Object.entries(fromB)) {
    for (const e of list ?? []) {
      if (e.id === idA) continue;
      const aKinds = aNeighbors.get(e.id);
      if (!aKinds) continue;
      const via = new Set<EdgeKind>(aKinds);
      via.add(kind as EdgeKind);
      sharedNeighbors.push({ id: e.id, via: [...via] });
    }
  }

  return {
    cosine,
    directEdges,
    sharedDomain,
    sharedAffect,
    sameForm,
    sameSource,
    sharedNeighbors,
  };
}
