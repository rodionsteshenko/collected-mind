import { beforeEach, describe, expect, it } from "vitest";

import { corpus } from "@/lib/advisor/corpus";
import {
  ALL_EDGE_KINDS,
  analogy,
  bridge,
  explain,
  mmr,
  shortestPath,
  triangulate,
  weightedSample,
} from "@/lib/corpus/retrieval";

import { buildEdges, makeConcept, seedCorpus, tinyCorpus } from "./test-helpers";

beforeEach(() => {
  seedCorpus(tinyCorpus());
});

describe("Corpus.cosineTopK", () => {
  it("ranks concepts by cosine similarity to the query", () => {
    // Query (1, 0) should rank α=1.0, α'=0.95, β'=0.31, β=0, anti-α=-1
    const q = new Float32Array([1, 0]);
    const top = corpus.cosineTopK(q, 5);
    expect(top.map((h) => h.id)).toEqual([1, 2, 4, 3, 5]);
    expect(top[0].score).toBeCloseTo(1, 4);
    expect(top[4].score).toBeCloseTo(-1, 4);
  });
});

describe("mmr", () => {
  it("with lambda=1 (pure relevance) matches cosineTopK ordering", () => {
    const q = new Float32Array([1, 0]);
    const ranked = mmr(q, 3, 1.0);
    expect(ranked.map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it("with lambda=0 (pure diversity) avoids near-duplicates after the first pick", () => {
    // After picking α (closest to query), pure-diversity should next
    // pick the *furthest* candidate from α, not α-prime.
    const q = new Float32Array([1, 0]);
    const ranked = mmr(q, 2, 0);
    expect(ranked[0].id).toBe(1);
    // α-prime is very close to α (sim ≈ 0.95). Diversity should skip it.
    expect(ranked[1].id).not.toBe(2);
  });

  it("returns at most k items even when pool is smaller", () => {
    const q = new Float32Array([1, 0]);
    const ranked = mmr(q, 100, 0.5);
    expect(ranked.length).toBeLessThanOrEqual(corpus.embIds.length);
  });

  it("attaches both score (mmr) and relevance (raw cosine) to each result", () => {
    const q = new Float32Array([1, 0]);
    const ranked = mmr(q, 3, 0.5);
    for (const r of ranked) {
      expect(typeof r.score).toBe("number");
      expect(typeof r.relevance).toBe("number");
    }
    // Relevance for top item must equal pure cosine
    expect(ranked[0].relevance).toBeCloseTo(1, 4);
  });
});

describe("bridge", () => {
  it("ranks balanced candidates higher than lopsided ones", () => {
    // Bridge α=(1,0) and β=(0,1). Candidates: α'(0.95,0.31), β'(0.31,0.95), anti-α(-1,0).
    // α' similarity to α≈0.95, to β≈0.31 → balanced score = 0.95+0.31-0.64=0.62
    // β' similarity to α≈0.31, to β≈0.95 → 0.31+0.95-0.64=0.62
    // anti-α to α=-1, to β=0 → -1+0-1=-2
    const hits = bridge(1, 3, 5);
    expect(hits[0].id).not.toBe(5); // anti-α should rank last
    expect(hits.map((h) => h.id)).not.toContain(1); // excludes seeds
    expect(hits.map((h) => h.id)).not.toContain(3);
  });

  it("returns simA/simB consistent with the embeddings", () => {
    const hits = bridge(1, 3, 5);
    for (const h of hits) {
      expect(h.simA).toBeGreaterThanOrEqual(-1);
      expect(h.simA).toBeLessThanOrEqual(1);
      expect(h.simB).toBeGreaterThanOrEqual(-1);
      expect(h.simB).toBeLessThanOrEqual(1);
      expect(h.score).toBeCloseTo(h.simA + h.simB - Math.abs(h.simA - h.simB), 4);
    }
  });

  it("returns empty array when either id is missing", () => {
    expect(bridge(999, 3, 5)).toEqual([]);
    expect(bridge(1, 999, 5)).toEqual([]);
  });
});

describe("triangulate", () => {
  it("excludes the seed ids from results", () => {
    const hits = triangulate([1, 3], 5);
    for (const h of hits) {
      expect(h.id).not.toBe(1);
      expect(h.id).not.toBe(3);
    }
  });

  it("centroid of α(1,0) and β(0,1) is closer to α'/β' than anti-α", () => {
    const hits = triangulate([1, 3], 5);
    const ids = hits.map((h) => h.id);
    // anti-α is at (-1,0). Centroid is at (~0.71, 0.71). Cosine with anti-α ≈ -0.71.
    // It should rank last among non-seed concepts.
    expect(ids[ids.length - 1]).toBe(5);
  });

  it("returns empty when seed ids are unknown", () => {
    expect(triangulate([999, 998], 5)).toEqual([]);
  });
});

describe("analogy", () => {
  it("filters candidate pool by domain and excludes the seed", () => {
    const hits = analogy(1, { domain: "biology", k: 5 });
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain(1);
    // Only β (id=3) and β' (id=4) are biology
    expect(new Set(ids)).toEqual(new Set([3, 4]));
  });

  it("filters by form when specified", () => {
    // form=phenomenon → only β (id=3)
    const hits = analogy(1, { form: "phenomenon", k: 5 });
    expect(hits.map((h) => h.id)).toEqual([3]);
  });

  it("combines domain + form (intersection)", () => {
    // domain=biology AND form=concept → only β' (id=4)
    const hits = analogy(1, { domain: "biology", form: "concept", k: 5 });
    expect(hits.map((h) => h.id)).toEqual([4]);
  });

  it("ranks by cosine similarity to seed", () => {
    const hits = analogy(1, { domain: "biology", k: 5 });
    // β'(0.31,0.95) is closer to α(1,0) than β(0,1) is
    expect(hits[0].id).toBe(4);
    expect(hits[1].id).toBe(3);
  });

  it("returns empty for unknown seed", () => {
    expect(analogy(999, { domain: "biology", k: 5 })).toEqual([]);
  });
});

describe("shortestPath", () => {
  beforeEach(() => {
    // Build a graph: 1 — 2 — 3 — 4   (semantic_near)
    //                       \— 5     (prerequisite_of)
    const edges = buildEdges([
      { from: 1, to: 2, kind: "semantic_near", w: 0.9 },
      { from: 2, to: 3, kind: "semantic_near", w: 0.8 },
      { from: 3, to: 4, kind: "semantic_near", w: 0.7 },
      { from: 3, to: 5, kind: "prerequisite_of", w: 0.6 },
    ]);
    seedCorpus({ ...tinyCorpus(), edges });
  });

  it("returns trivial result when from == to", () => {
    const r = shortestPath(1, 1);
    expect(r).toEqual({ ids: [1], steps: [], cost: 0 });
  });

  it("finds a multi-hop path through semantic_near", () => {
    const r = shortestPath(1, 4);
    expect(r).not.toBeNull();
    expect(r!.ids).toEqual([1, 2, 3, 4]);
    expect(r!.steps.length).toBe(3);
    // Each step weight matches the constructed edge
    expect(r!.steps[0].w).toBeCloseTo(0.9);
    expect(r!.steps[2].w).toBeCloseTo(0.7);
  });

  it("returns null when no path exists within maxHops", () => {
    expect(shortestPath(1, 4, { maxHops: 2 })).toBeNull();
  });

  it("returns null when nodes are unreachable", () => {
    // Reseed with an isolated node 5 (disconnected from 1-4 chain)
    const edges = buildEdges([
      { from: 1, to: 2, kind: "semantic_near", w: 0.9 },
    ]);
    seedCorpus({ ...tinyCorpus(), edges });
    expect(shortestPath(1, 5)).toBeNull();
  });

  it("respects the kinds filter", () => {
    // Restrict to prerequisite_of only — there's no path from 1 to 4 that way.
    const r = shortestPath(1, 4, { kinds: ["prerequisite_of"] });
    expect(r).toBeNull();
    // But 3 → 5 *is* reachable via prerequisite_of alone (after rebuilding adj)
    const r2 = shortestPath(3, 5, { kinds: ["prerequisite_of"] });
    expect(r2).not.toBeNull();
    expect(r2!.ids).toEqual([3, 5]);
  });

  it("treats edges as bidirectional (can walk reverse direction)", () => {
    // Edges were built 1→2→3, so this confirms the undirected adjacency.
    const r = shortestPath(4, 1);
    expect(r).not.toBeNull();
    expect(r!.ids).toEqual([4, 3, 2, 1]);
  });

  it("ALL_EDGE_KINDS contains the edge kinds we declared", () => {
    expect(ALL_EDGE_KINDS).toContain("semantic_near");
    expect(ALL_EDGE_KINDS).toContain("prerequisite_of");
    expect(ALL_EDGE_KINDS.length).toBe(7);
  });
});

describe("weightedSample", () => {
  it("returns at most k items, no duplicates", () => {
    const ids = [1, 2, 3, 4, 5];
    const picked = weightedSample(ids, 3);
    expect(picked.length).toBe(3);
    expect(new Set(picked).size).toBe(3);
  });

  it("returns up to pool size when k exceeds it", () => {
    const ids = [1, 2, 3];
    const picked = weightedSample(ids, 100);
    expect(picked.length).toBe(3);
  });

  it("only returns ids present in the input pool", () => {
    const ids = [1, 3, 5];
    const allowed = new Set(ids);
    for (let i = 0; i < 50; i++) {
      const picked = weightedSample(ids, 2);
      for (const p of picked) expect(allowed.has(p)).toBe(true);
    }
  });

  it("biases toward higher-weight items in expectation", () => {
    // α has surprise=5, α-prime has surprise=7 → α-prime should be picked more.
    let alphaPrimeWins = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const picked = weightedSample([1, 2], 1, { surpriseTemp: 4, obscurityTemp: 0 });
      if (picked[0] === 2) alphaPrimeWins++;
    }
    // With a strong surpriseTemp the high-surprise item should win comfortably > 50%.
    expect(alphaPrimeWins / trials).toBeGreaterThan(0.6);
  });

  it("skips ids that are not in the corpus", () => {
    const picked = weightedSample([999, 998], 5);
    expect(picked).toEqual([]);
  });
});

describe("explain", () => {
  it("returns null when either id is unknown", () => {
    expect(explain(1, 999)).toBeNull();
    expect(explain(999, 1)).toBeNull();
  });

  it("computes shared facets between two concepts", () => {
    const a = makeConcept({ id: 10, slug: "A", title: "A", domain: ["philosophy", "psychology"], affect: ["calm"], form: "concept", source: "wiki" });
    const b = makeConcept({ id: 20, slug: "B", title: "B", domain: ["psychology", "biology"], affect: ["awe"], form: "concept", source: "manual" });
    seedCorpus({
      concepts: [a, b],
      embeddings: [[1, 0], [0, 1]],
    });
    const exp = explain(10, 20);
    expect(exp).not.toBeNull();
    expect(exp!.sharedDomain).toEqual(["psychology"]);
    expect(exp!.sharedAffect).toEqual([]);
    expect(exp!.sameForm).toBe(true);
    expect(exp!.sameSource).toBe(false);
  });

  it("reports cosine similarity from the embeddings", () => {
    const a = makeConcept({ id: 10, slug: "A", title: "A" });
    const b = makeConcept({ id: 20, slug: "B", title: "B" });
    seedCorpus({ concepts: [a, b], embeddings: [[1, 0], [1, 0]] });
    const exp = explain(10, 20);
    expect(exp!.cosine).toBeCloseTo(1, 4);
  });

  it("collects direct edges with their direction", () => {
    const edges = buildEdges([
      { from: 1, to: 3, kind: "semantic_near", w: 0.9 },
      { from: 3, to: 1, kind: "contrasts_with", w: 0.5 },
    ]);
    seedCorpus({ ...tinyCorpus(), edges });
    const exp = explain(1, 3);
    expect(exp!.directEdges).toEqual(
      expect.arrayContaining([
        { kind: "semantic_near", w: 0.9, direction: "a_to_b" },
        { kind: "contrasts_with", w: 0.5, direction: "b_to_a" },
      ]),
    );
  });

  it("finds shared neighbors with the edge kinds linking each side", () => {
    // 1 → 2 (semantic_near), 3 → 2 (contrasts_with)  ⇒  2 is a shared neighbor.
    const edges = buildEdges([
      { from: 1, to: 2, kind: "semantic_near", w: 0.9 },
      { from: 3, to: 2, kind: "contrasts_with", w: 0.5 },
    ]);
    seedCorpus({ ...tinyCorpus(), edges });
    const exp = explain(1, 3);
    expect(exp!.sharedNeighbors).toEqual([
      { id: 2, via: expect.arrayContaining(["semantic_near", "contrasts_with"]) },
    ]);
  });

  it("does not list the other endpoint as its own shared neighbor", () => {
    const edges = buildEdges([
      { from: 1, to: 3, kind: "semantic_near", w: 0.9 },
    ]);
    seedCorpus({ ...tinyCorpus(), edges });
    const exp = explain(1, 3);
    const sharedIds = exp!.sharedNeighbors.map((n) => n.id);
    expect(sharedIds).not.toContain(1);
    expect(sharedIds).not.toContain(3);
  });
});
