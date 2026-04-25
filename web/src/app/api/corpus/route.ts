import { corpus } from "@/lib/advisor/corpus";
import { jsonResponse, optionsResponse } from "@/lib/corpus/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  await corpus.load();
  const base = new URL(req.url).origin + "/api/corpus";
  return jsonResponse({
    name: "collected-mind corpus API",
    total: corpus.concepts.length,
    endpoints: {
      "GET /api/corpus": "this index",
      "GET /api/corpus/facets": "enumerate available form, domain, affect, source values + counts",
      "GET /api/corpus/search?q=&k=&form=&domain=&affect=&source=&minObscurity=&maxObscurity=":
        "fuzzy text search across title/oneLiner/aha with optional facet filters",
      "GET /api/corpus/semantic?q=&k=&form=&domain=&affect=&source=&minObscurity=&maxObscurity=":
        "embedding cosine search with optional facet filters",
      "GET /api/corpus/filter?form=&domain=&affect=&source=&minObscurity=&maxObscurity=&minSurprise=&maxSurprise=&sort=surprise|obscurity|title&k=&offset=":
        "pure facet filter; paginated",
      "GET /api/corpus/concepts/[slug]": "full concept payload",
      "GET /api/corpus/concepts/[slug]/neighbors?kind=semantic_near|prerequisite_of|contrasts_with|...&k=":
        "graph neighbors with optional facet filters",
      "GET /api/corpus/semantic?...&mmr=1&lambda=0.5":
        "semantic search with maximal-marginal-relevance reranking for diversity (lambda=1 pure relevance, 0 pure diversity)",
      "GET /api/corpus/bridge?from=&to=&k=":
        "concepts that bridge two seeds — high similarity to both, balanced",
      "GET /api/corpus/triangulate?slugs=a,b,c&k=":
        "concepts near the centroid of multiple seeds",
      "GET /api/corpus/analogy?slug=&domain=&form=&k=":
        "'like X but in domain Y' — same concept, different territory",
      "GET /api/corpus/path?from=&to=&maxHops=&kinds=":
        "shortest weighted path through the edge graph (high-weight edges preferred)",
      "GET /api/corpus/random?k=&surpriseTemp=&obscurityTemp=&anchor=&anchorPool=&form=&domain=&affect=":
        "weighted serendipitous sample, biased toward surprise × obscurity, optional seed anchor",
      "GET /api/corpus/explain?from=&to=":
        "structured connection metadata between two concepts (cosine, edges, shared facets/neighbors)",
      "GET /api/corpus/clusters": "list all precomputed clusters with sizes, top terms, representatives",
      "GET /api/corpus/clusters/[id]?sort=&k=&offset=&form=&domain=&affect=":
        "members of a single cluster with optional filters",
      "GET /api/corpus/concepts/[slug]/cluster":
        "which cluster a given concept belongs to",
      "POST /api/mcp": "Streamable-HTTP MCP server exposing all retrieval tools",
    },
    example: `${base}/search?q=blind+spot&k=5&form=bias`,
  });
}
