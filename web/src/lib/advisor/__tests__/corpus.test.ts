/**
 * Integration tests against the real exported corpus on disk.
 *
 * These exercise the full load path (concepts.json + embeddings.bin +
 * embeddings_meta.json + edges.json + clusters.json) and confirm the
 * derived indexes are consistent with each other.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/advisor/corpus";

const dataDir = path.join(process.cwd(), "public", "data");
const hasData =
  fs.existsSync(path.join(dataDir, "concepts.json")) &&
  fs.existsSync(path.join(dataDir, "embeddings.bin")) &&
  fs.existsSync(path.join(dataDir, "embeddings_meta.json")) &&
  fs.existsSync(path.join(dataDir, "edges.json"));

const d = hasData ? describe : describe.skip;

d("Corpus.load (real data)", () => {
  it("populates concepts, indexes, embeddings, edges, and clusters", async () => {
    await corpus.load();

    expect(corpus.concepts.length).toBeGreaterThan(0);
    expect(corpus.bySlug.size).toBe(corpus.concepts.length);
    expect(corpus.byId.size).toBe(corpus.concepts.length);
    expect(corpus.embDim).toBeGreaterThan(0);
    expect(corpus.embIds.length).toBeGreaterThan(0);
    expect(corpus.embeddings.length).toBe(corpus.embIds.length * corpus.embDim);
    expect(corpus.embIndexById.size).toBe(corpus.embIds.length);
    expect(Object.keys(corpus.edges).length).toBeGreaterThan(0);
    // Clusters file is optional but our pipeline writes it.
    if (fs.existsSync(path.join(dataDir, "clusters.json"))) {
      expect(corpus.clusters.length).toBeGreaterThan(0);
      expect(corpus.clusterOfConcept.size).toBe(corpus.concepts.length);
    }
  });

  it("embeddings are L2-normalized (cosine == dot)", async () => {
    await corpus.load();
    // Sample a handful and check the L2 norm is ~1.
    const sample = [0, Math.floor(corpus.embIds.length / 2), corpus.embIds.length - 1];
    for (const i of sample) {
      const off = i * corpus.embDim;
      let n2 = 0;
      for (let j = 0; j < corpus.embDim; j++) {
        const x = corpus.embeddings[off + j];
        n2 += x * x;
      }
      expect(Math.sqrt(n2)).toBeCloseTo(1, 3);
    }
  });

  it("embeddingForId returns a valid view aligned with embIds", async () => {
    await corpus.load();
    for (const id of corpus.embIds.slice(0, 5)) {
      const v = corpus.embeddingForId(id);
      expect(v).not.toBeNull();
      expect(v!.length).toBe(corpus.embDim);
      // It's a subarray view, not a copy — same backing buffer.
      expect(v!.buffer).toBe(corpus.embeddings.buffer);
    }
    expect(corpus.embeddingForId(-1)).toBeNull();
  });

  it("cosineTopK self-query returns the source concept first with score ≈ 1", async () => {
    await corpus.load();
    const id = corpus.embIds[0];
    const v = corpus.embeddingForId(id)!;
    const top = corpus.cosineTopK(v, 3);
    expect(top[0].id).toBe(id);
    expect(top[0].score).toBeCloseTo(1, 3);
    // Subsequent results have score < self
    expect(top[1].score).toBeLessThanOrEqual(top[0].score);
  });

  it("cluster assignments reference real cluster ids and concepts", async () => {
    await corpus.load();
    if (corpus.clusters.length === 0) return; // skipped by guard above
    const clusterIdSet = new Set(corpus.clusters.map((c) => c.id));
    for (const [cid, label] of corpus.clusterOfConcept) {
      expect(clusterIdSet.has(label)).toBe(true);
      expect(corpus.byId.has(cid)).toBe(true);
    }
  });

  it("cluster representatives are real concept ids", async () => {
    await corpus.load();
    for (const cluster of corpus.clusters) {
      for (const repId of cluster.representatives) {
        expect(corpus.byId.has(repId)).toBe(true);
      }
    }
  });

  it("edge endpoints all resolve to known concepts", async () => {
    await corpus.load();
    let checked = 0;
    for (const [src, byKind] of Object.entries(corpus.edges)) {
      expect(corpus.byId.has(Number(src))).toBe(true);
      for (const list of Object.values(byKind)) {
        for (const e of list ?? []) {
          expect(corpus.byId.has(e.id)).toBe(true);
          expect(e.w).toBeGreaterThanOrEqual(0);
          expect(e.w).toBeLessThanOrEqual(1.0001);
          checked++;
          if (checked > 500) return; // sample is enough
        }
      }
    }
  });

  it("MiniSearch returns hits for any concept's exact title", async () => {
    await corpus.load();
    const sample = corpus.concepts.slice(0, 3);
    for (const c of sample) {
      const hits = corpus.search.search(c.title);
      expect(hits.length).toBeGreaterThan(0);
      // Self should rank in the top few results (not necessarily #1 for short titles).
      const ids = hits.slice(0, 5).map((h) => h.id);
      expect(ids).toContain(c.id);
    }
  });

  it("load() is idempotent — second call doesn't double-index", async () => {
    await corpus.load();
    const n1 = corpus.bySlug.size;
    await corpus.load();
    expect(corpus.bySlug.size).toBe(n1);
  });
});
