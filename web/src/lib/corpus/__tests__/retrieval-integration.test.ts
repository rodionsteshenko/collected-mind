/**
 * End-to-end smoke tests for retrieval primitives against the real corpus.
 *
 * These don't reseed; they trust whatever was exported to web/public/data and
 * verify each primitive returns sensible, well-formed results.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/advisor/corpus";
import {
  analogy,
  bridge,
  explain,
  mmr,
  shortestPath,
  triangulate,
  weightedSample,
} from "@/lib/corpus/retrieval";

const dataDir = path.join(process.cwd(), "public", "data");
const hasData = fs.existsSync(path.join(dataDir, "concepts.json"));
const d = hasData ? describe : describe.skip;

function pickPair(a: string, b: string) {
  const ca = corpus.bySlug.get(a);
  const cb = corpus.bySlug.get(b);
  return { ca, cb };
}

d("retrieval primitives (real corpus)", () => {
  it("mmr returns k diverse results that don't repeat", async () => {
    await corpus.load();
    const seed = corpus.concepts[0];
    const v = corpus.embeddingForId(seed.id)!;
    const ranked = mmr(v, 8, 0.5);
    expect(ranked.length).toBe(8);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(8);
    for (const r of ranked) {
      expect(r.relevance).toBeGreaterThanOrEqual(-1);
      expect(r.relevance).toBeLessThanOrEqual(1);
    }
  });

  it("bridge between two known concepts surfaces non-seed candidates", async () => {
    await corpus.load();
    const { ca, cb } = pickPair("eudaimonia", "antifragility");
    if (!ca || !cb) return;
    const hits = bridge(ca.id, cb.id, 5);
    expect(hits.length).toBe(5);
    for (const h of hits) {
      expect(h.id).not.toBe(ca.id);
      expect(h.id).not.toBe(cb.id);
      expect(h.score).toBeCloseTo(h.simA + h.simB - Math.abs(h.simA - h.simB), 3);
    }
  });

  it("triangulate excludes seeds and returns up to k candidates", async () => {
    await corpus.load();
    const seeds = ["wabi-sabi", "kintsugi", "mono-no-aware"]
      .map((s) => corpus.bySlug.get(s))
      .filter((c): c is NonNullable<typeof c> => c != null);
    if (seeds.length < 2) return;
    const ids = seeds.map((c) => c.id);
    const seedSet = new Set(ids);
    const hits = triangulate(ids, 8);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(seedSet.has(h.id)).toBe(false);
  });

  it("analogy restricts to a different domain", async () => {
    await corpus.load();
    const seed = corpus.concepts.find((c) => c.domain.length > 0);
    if (!seed) return;
    const targetDomain = "biology";
    const hits = analogy(seed.id, { domain: targetDomain, k: 5 });
    for (const h of hits) {
      const c = corpus.byId.get(h.id);
      expect(c).toBeDefined();
      expect(c!.domain).toContain(targetDomain);
      expect(c!.id).not.toBe(seed.id);
    }
  });

  it("shortestPath finds a chain between two related concepts", async () => {
    await corpus.load();
    const { ca, cb } = pickPair("dukkha", "samsara");
    if (!ca || !cb) return;
    const r = shortestPath(ca.id, cb.id, { maxHops: 8 });
    expect(r).not.toBeNull();
    expect(r!.ids[0]).toBe(ca.id);
    expect(r!.ids[r!.ids.length - 1]).toBe(cb.id);
    // Each adjacent pair should appear as a step
    for (let i = 0; i < r!.steps.length; i++) {
      expect(r!.steps[i].from).toBe(r!.ids[i]);
      expect(r!.steps[i].to).toBe(r!.ids[i + 1]);
    }
  });

  it("weightedSample returns k distinct ids drawn from the corpus", async () => {
    await corpus.load();
    const ids = corpus.concepts.slice(0, 200).map((c) => c.id);
    const picked = weightedSample(ids, 10);
    expect(picked.length).toBe(10);
    expect(new Set(picked).size).toBe(10);
    const allowed = new Set(ids);
    for (const p of picked) expect(allowed.has(p)).toBe(true);
  });

  it("explain reports cosine + facet overlap for two concepts in the same cluster", async () => {
    await corpus.load();
    if (corpus.clusters.length === 0) return;
    // Pick the two largest representatives of the largest cluster.
    const big = [...corpus.clusters].sort((a, b) => b.size - a.size)[0];
    if (big.representatives.length < 2) return;
    const a = corpus.byId.get(big.representatives[0])!;
    const b = corpus.byId.get(big.representatives[1])!;
    const exp = explain(a.id, b.id);
    expect(exp).not.toBeNull();
    expect(exp!.cosine).not.toBeNull();
    // Two reps of the same cluster should be similar
    expect(exp!.cosine!).toBeGreaterThan(0.3);
  });
});
