import fs from "node:fs/promises";
import path from "node:path";

import MiniSearch from "minisearch";

import type { Cluster, Clusters, Concept, EdgeMap } from "../types";

type EmbeddingsMeta = { ids: number[]; dim: number; model: string };

class Corpus {
  concepts: Concept[] = [];
  bySlug = new Map<string, Concept>();
  byId = new Map<number, Concept>();
  embeddings!: Float32Array;
  embIds: number[] = [];
  embDim = 0;
  embIndexById = new Map<number, number>();
  search!: MiniSearch<Concept>;
  edges: EdgeMap = {};
  clusters: Cluster[] = [];
  clusterById = new Map<number, Cluster>();
  clusterOfConcept = new Map<number, number>();
  private loaded = false;

  async load() {
    if (this.loaded) return;
    const dataDir = path.join(process.cwd(), "public", "data");
    const [cJson, mJson, embBuf, eJson, clJson] = await Promise.all([
      fs.readFile(path.join(dataDir, "concepts.json"), "utf8"),
      fs.readFile(path.join(dataDir, "embeddings_meta.json"), "utf8"),
      fs.readFile(path.join(dataDir, "embeddings.bin")),
      fs.readFile(path.join(dataDir, "edges.json"), "utf8"),
      // Clusters are optional — pre-cluster pipeline runs won't have written this.
      fs.readFile(path.join(dataDir, "clusters.json"), "utf8").catch(() => ""),
    ]);

    this.concepts = JSON.parse(cJson) as Concept[];
    for (const c of this.concepts) {
      this.bySlug.set(c.slug, c);
      this.byId.set(c.id, c);
    }

    const meta = JSON.parse(mJson) as EmbeddingsMeta;
    this.embIds = meta.ids;
    this.embDim = meta.dim;
    this.embeddings = new Float32Array(
      embBuf.buffer,
      embBuf.byteOffset,
      embBuf.byteLength / 4,
    );
    for (let i = 0; i < this.embIds.length; i++) this.embIndexById.set(this.embIds[i], i);

    this.edges = JSON.parse(eJson) as EdgeMap;

    if (clJson) {
      const cl = JSON.parse(clJson) as Clusters;
      this.clusters = cl.clusters;
      for (const c of cl.clusters) this.clusterById.set(c.id, c);
      for (const [cid, label] of Object.entries(cl.assignments)) {
        this.clusterOfConcept.set(Number(cid), label);
      }
    }

    this.search = new MiniSearch<Concept>({
      idField: "id",
      fields: ["title", "oneLiner", "aha"],
      storeFields: ["id", "slug", "title", "oneLiner", "domain", "form"],
      searchOptions: { boost: { title: 3, oneLiner: 2 }, fuzzy: 0.15, prefix: true },
    });
    this.search.addAll(this.concepts);
    this.loaded = true;
  }

  embeddingForId(id: number): Float32Array | null {
    const i = this.embIndexById.get(id);
    if (i == null) return null;
    return this.embeddings.subarray(i * this.embDim, (i + 1) * this.embDim);
  }

  cosineTopK(query: Float32Array, k: number): { id: number; score: number }[] {
    const d = this.embDim;
    const n = this.embIds.length;
    const scores = new Float32Array(n);
    const emb = this.embeddings;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const off = i * d;
      for (let j = 0; j < d; j++) s += emb[off + j] * query[j];
      scores[i] = s;
    }
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((a, b) => scores[b] - scores[a]);
    const top = idx.slice(0, k);
    return top.map((i) => ({ id: this.embIds[i], score: scores[i] }));
  }
}

export const corpus = new Corpus();
