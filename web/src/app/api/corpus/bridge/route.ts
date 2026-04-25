import { corpus } from "@/lib/advisor/corpus";
import {
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  slim,
} from "@/lib/corpus/api";
import { bridge } from "@/lib/corpus/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  await corpus.load();
  const sp = new URL(req.url).searchParams;
  const fromSlug = (sp.get("from") ?? "").trim();
  const toSlug = (sp.get("to") ?? "").trim();
  if (!fromSlug || !toSlug) {
    return errorResponse("query parameters 'from' and 'to' (slugs) are required");
  }
  const from = corpus.bySlug.get(fromSlug);
  const to = corpus.bySlug.get(toSlug);
  if (!from) return errorResponse(`'from' concept '${fromSlug}' not found`, 404);
  if (!to) return errorResponse(`'to' concept '${toSlug}' not found`, 404);
  const k = clampInt(sp.get("k"), 10, 1, 50);

  const hits = bridge(from.id, to.id, k);
  const results = hits
    .map((h) => {
      const c = corpus.byId.get(h.id);
      if (!c) return null;
      return {
        ...slim(c),
        score: Number(h.score.toFixed(4)),
        simFrom: Number(h.simA.toFixed(4)),
        simTo: Number(h.simB.toFixed(4)),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return jsonResponse({
    from: { slug: from.slug, title: from.title },
    to: { slug: to.slug, title: to.title },
    k,
    count: results.length,
    results,
  });
}
