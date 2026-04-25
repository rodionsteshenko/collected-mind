import { corpus } from "@/lib/advisor/corpus";

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
