import { corpus } from "@/lib/advisor/corpus";
import {
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  slim,
} from "@/lib/corpus/api";
import { triangulate } from "@/lib/corpus/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  await corpus.load();
  const sp = new URL(req.url).searchParams;
  const slugsRaw = (sp.get("slugs") ?? "").trim();
  if (!slugsRaw) {
    return errorResponse("query parameter 'slugs' (comma-separated) is required");
  }
  const slugs = slugsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (slugs.length < 2) {
    return errorResponse("'slugs' must contain at least 2 comma-separated values");
  }
  const seeds = [];
  const missing: string[] = [];
  for (const s of slugs) {
    const c = corpus.bySlug.get(s);
    if (!c) missing.push(s);
    else seeds.push({ slug: c.slug, title: c.title, id: c.id });
  }
  if (missing.length) return errorResponse(`unknown slugs: ${missing.join(", ")}`, 404);
  const k = clampInt(sp.get("k"), 10, 1, 50);

  const hits = triangulate(seeds.map((s) => s.id), k);
  const results = hits
    .map((h) => {
      const c = corpus.byId.get(h.id);
      if (!c) return null;
      return { ...slim(c), score: Number(h.score.toFixed(4)) };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return jsonResponse({
    seeds: seeds.map(({ slug, title }) => ({ slug, title })),
    k,
    count: results.length,
    results,
  });
}
