import { corpus } from "@/lib/advisor/corpus";
import type { Cluster, Concept, EdgeKind, EdgeMap, QuoteMap } from "@/lib/types";

/** Build a Concept with sensible defaults; override only the fields a test cares about. */
export function makeConcept(over: Partial<Concept> & { id: number; slug: string; title: string }): Concept {
  return {
    source: "test",
    wikiUrl: "",
    oneLiner: `${over.title} — one-liner`,
    aha: "",
    example: "",
    domain: ["philosophy"],
    form: "concept",
    affect: ["calm"],
    obscurity: 3,
    surprise: 5,
    ...over,
  };
}

/** L2-normalize an array (in place return). */
export function normalize(v: number[]): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export type SeedInput = {
  concepts: Concept[];
  /** Per-concept embedding (will be L2-normalized). Must align with concepts[]. */
  embeddings?: number[][];
  edges?: EdgeMap;
  clusters?: { k: number; clusters: Cluster[]; assignments: Record<string, number> };
  quotes?: QuoteMap;
};

/**
 * Reset the singleton corpus and reseed it with the given synthetic data.
 * Bypasses load() so unit tests don't touch the filesystem.
 */
export function seedCorpus(input: SeedInput): void {
  corpus.concepts = input.concepts;
  corpus.bySlug.clear();
  corpus.byId.clear();
  for (const c of input.concepts) {
    corpus.bySlug.set(c.slug, c);
    corpus.byId.set(c.id, c);
  }

  if (input.embeddings && input.embeddings.length) {
    const dim = input.embeddings[0].length;
    const flat = new Float32Array(input.embeddings.length * dim);
    for (let i = 0; i < input.embeddings.length; i++) {
      const v = normalize(input.embeddings[i]);
      flat.set(v, i * dim);
    }
    corpus.embeddings = flat;
    corpus.embDim = dim;
    corpus.embIds = input.concepts.map((c) => c.id);
    corpus.embIndexById.clear();
    for (let i = 0; i < corpus.embIds.length; i++) corpus.embIndexById.set(corpus.embIds[i], i);
  } else {
    corpus.embeddings = new Float32Array();
    corpus.embDim = 0;
    corpus.embIds = [];
    corpus.embIndexById.clear();
  }

  corpus.edges = input.edges ?? {};

  if (input.clusters) {
    corpus.clusters = input.clusters.clusters;
    corpus.clusterById.clear();
    for (const c of input.clusters.clusters) corpus.clusterById.set(c.id, c);
    corpus.clusterOfConcept.clear();
    for (const [cid, label] of Object.entries(input.clusters.assignments)) {
      corpus.clusterOfConcept.set(Number(cid), label);
    }
  } else {
    corpus.clusters = [];
    corpus.clusterById.clear();
    corpus.clusterOfConcept.clear();
  }

  corpus.quotes = input.quotes ?? {};
  // Mark as loaded so route handlers calling `await corpus.load()` short-circuit
  // and don't try to read fixture files from disk.
  corpus.loaded = true;
}

/**
 * Build a tiny, deterministic 2D corpus useful for cosine-based tests.
 * Five concepts whose embedding vectors form distinct directions:
 *   1 →  e=(1, 0)        philosophy   form=concept
 *   2 →  e=(0.95, 0.31)  philosophy   form=concept   (close to 1)
 *   3 →  e=(0, 1)        biology      form=phenomenon
 *   4 →  e=(0.31, 0.95)  biology      form=concept   (close to 3)
 *   5 →  e=(-1, 0)       sociology    form=principle (opposite of 1)
 */
export function tinyCorpus(): SeedInput {
  const concepts: Concept[] = [
    makeConcept({ id: 1, slug: "alpha", title: "Alpha", domain: ["philosophy"], form: "concept", surprise: 5, obscurity: 2 }),
    makeConcept({ id: 2, slug: "alpha-prime", title: "Alpha Prime", domain: ["philosophy"], form: "concept", surprise: 7, obscurity: 4 }),
    makeConcept({ id: 3, slug: "beta", title: "Beta", domain: ["biology"], form: "phenomenon", surprise: 3, obscurity: 1 }),
    makeConcept({ id: 4, slug: "beta-prime", title: "Beta Prime", domain: ["biology"], form: "concept", surprise: 9, obscurity: 5 }),
    makeConcept({ id: 5, slug: "anti-alpha", title: "Anti Alpha", domain: ["sociology"], form: "principle", surprise: 4, obscurity: 3 }),
  ];
  const embeddings = [
    [1, 0],
    [0.95, 0.31],
    [0, 1],
    [0.31, 0.95],
    [-1, 0],
  ];
  return { concepts, embeddings };
}

/** Helper to build EdgeMap entries succinctly for tests. */
export function buildEdges(rows: { from: number; to: number; kind: EdgeKind; w: number }[]): EdgeMap {
  const out: EdgeMap = {};
  for (const r of rows) {
    const key = String(r.from);
    if (!out[key]) out[key] = {};
    if (!out[key][r.kind]) out[key][r.kind] = [];
    out[key][r.kind]!.push({ id: r.to, w: r.w });
  }
  return out;
}
