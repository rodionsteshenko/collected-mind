import fs from "node:fs/promises";
import path from "node:path";

import type { Concept, EdgeMap, Tags } from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const buf = await fs.readFile(path.join(DATA_DIR, name), "utf8");
    return JSON.parse(buf) as T;
  } catch {
    return fallback;
  }
}

export const loadConcepts = (): Promise<Concept[]> =>
  readJson<Concept[]>("concepts.json", []);

export const loadEdges = (): Promise<EdgeMap> =>
  readJson<EdgeMap>("edges.json", {} as EdgeMap);

export const loadTags = (): Promise<Tags> =>
  readJson<Tags>("tags.json", {
    domain: [],
    form: [],
    affect: [],
    source: [],
    obscurity: [],
    total: 0,
  });

export async function loadConceptsBySlug(): Promise<Map<string, Concept>> {
  const cs = await loadConcepts();
  return new Map(cs.map((c) => [c.slug, c]));
}

export async function loadConceptsById(): Promise<Map<number, Concept>> {
  const cs = await loadConcepts();
  return new Map(cs.map((c) => [c.id, c]));
}
