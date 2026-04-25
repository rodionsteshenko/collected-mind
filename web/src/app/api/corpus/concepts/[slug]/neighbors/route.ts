import { corpus } from "@/lib/advisor/corpus";
import {
  applyFilters,
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  parseFilters,
  slim,
} from "@/lib/corpus/api";
import type { EdgeKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const ALLOWED_KINDS: EdgeKind[] = [
  "semantic_near",
  "semantic_dedup",
  "prerequisite_of",
  "specializes",
  "contrasts_with",
  "example_of",
  "same_phenomenon_different_frame",
];

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  await corpus.load();
  const c = corpus.bySlug.get(slug);
  if (!c) return errorResponse(`concept '${slug}' not found`, 404);

  const sp = new URL(req.url).searchParams;
  const k = clampInt(sp.get("k"), 10, 1, 50);
  const kindParam = sp.get("kind") as EdgeKind | null;
  const kind: EdgeKind = kindParam && ALLOWED_KINDS.includes(kindParam) ? kindParam : "semantic_near";
  const filters = parseFilters(sp);

  const edgeList = corpus.edges[String(c.id)]?.[kind] ?? [];
  const out: { score: number; weight: number }[] = [];
  for (const e of edgeList) {
    const n = corpus.byId.get(e.id);
    if (!n) continue;
    if (!applyFilters([n], filters).length) continue;
    out.push({ ...slim(n), score: e.w, weight: e.w });
    if (out.length >= k) break;
  }

  return jsonResponse({
    slug: c.slug,
    title: c.title,
    kind,
    k,
    count: out.length,
    results: out,
  });
}
