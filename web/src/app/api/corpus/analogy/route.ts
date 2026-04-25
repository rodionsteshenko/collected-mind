import { corpus } from "@/lib/advisor/corpus";
import {
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  slim,
} from "@/lib/corpus/api";
import { analogy } from "@/lib/corpus/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  await corpus.load();
  const sp = new URL(req.url).searchParams;
  const slug = (sp.get("slug") ?? "").trim();
  if (!slug) return errorResponse("query parameter 'slug' is required");
  const seed = corpus.bySlug.get(slug);
  if (!seed) return errorResponse(`concept '${slug}' not found`, 404);
  const domain = sp.get("domain") || undefined;
  const form = sp.get("form") || undefined;
  if (!domain && !form) {
    return errorResponse("at least one of 'domain' or 'form' is required");
  }
  const k = clampInt(sp.get("k"), 10, 1, 50);

  const hits = analogy(seed.id, { domain, form, k });
  const results = hits
    .map((h) => {
      const c = corpus.byId.get(h.id);
      if (!c) return null;
      return { ...slim(c), score: Number(h.score.toFixed(4)) };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return jsonResponse({
    seed: { slug: seed.slug, title: seed.title },
    domain,
    form,
    k,
    count: results.length,
    results,
  });
}
