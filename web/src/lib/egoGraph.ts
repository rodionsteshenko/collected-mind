import type { Concept, EdgeMap } from "./types";

export type EgoNode = {
  id: number;
  slug: string;
  title: string;
  form: string;
  isCenter: boolean;
};

export type EgoLink = {
  source: number;
  target: number;
  w: number;
};

export function buildEgoGraph(
  concept: Concept,
  edges: EdgeMap,
  byId: Map<number, Concept>,
): { nodes: EgoNode[]; links: EgoLink[] } {
  const outgoing = edges[String(concept.id)]?.semantic_near ?? [];
  const neighborIds = new Set<number>();
  const weightMap = new Map<string, number>();

  for (const e of outgoing) {
    neighborIds.add(e.id);
    weightMap.set(edgeKey(concept.id, e.id), e.w);
  }

  // Reciprocal: other concepts that list this one as a neighbor.
  for (const [srcId, kinds] of Object.entries(edges)) {
    const list = kinds.semantic_near ?? [];
    if (list.some((e) => e.id === concept.id)) {
      const sid = Number(srcId);
      if (sid !== concept.id) {
        neighborIds.add(sid);
        const reciprocal = list.find((e) => e.id === concept.id);
        if (reciprocal) {
          const k = edgeKey(concept.id, sid);
          const prev = weightMap.get(k) ?? 0;
          weightMap.set(k, Math.max(prev, reciprocal.w));
        }
      }
    }
  }

  const nodes: EgoNode[] = [toNode(concept, true)];
  for (const nid of neighborIds) {
    const c = byId.get(nid);
    if (c) nodes.push(toNode(c, false));
  }

  const links: EgoLink[] = [];
  const seenEdge = new Set<string>();

  const addLink = (a: number, b: number, w: number) => {
    const k = edgeKey(a, b);
    if (seenEdge.has(k)) return;
    seenEdge.add(k);
    links.push({ source: a, target: b, w });
  };

  for (const e of outgoing) {
    if (neighborIds.has(e.id)) addLink(concept.id, e.id, e.w);
  }
  for (const nid of neighborIds) {
    addLink(concept.id, nid, weightMap.get(edgeKey(concept.id, nid)) ?? 0.4);
  }

  // Interior edges among neighbors
  for (const nid of neighborIds) {
    const ne = edges[String(nid)]?.semantic_near ?? [];
    for (const e of ne) {
      if (neighborIds.has(e.id) && e.id !== nid) addLink(nid, e.id, e.w);
    }
  }

  return { nodes, links };
}

function toNode(c: Concept, isCenter: boolean): EgoNode {
  return { id: c.id, slug: c.slug, title: c.title, form: c.form, isCenter };
}

function edgeKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
