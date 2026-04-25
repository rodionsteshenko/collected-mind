import { corpus } from "@/lib/advisor/corpus";
import {
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  slim,
} from "@/lib/corpus/api";
import { ALL_EDGE_KINDS, shortestPath } from "@/lib/corpus/retrieval";
import type { EdgeKind } from "@/lib/types";

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

  const maxHops = clampInt(sp.get("maxHops"), 6, 1, 12);
  const kindsRaw = sp.get("kinds");
  const validKinds = new Set<EdgeKind>(ALL_EDGE_KINDS);
  let kinds: EdgeKind[] = ALL_EDGE_KINDS;
  if (kindsRaw) {
    const requested = kindsRaw.split(",").map((s) => s.trim()).filter(Boolean) as EdgeKind[];
    const bad = requested.filter((k) => !validKinds.has(k));
    if (bad.length) return errorResponse(`unknown edge kinds: ${bad.join(", ")}`);
    kinds = requested;
  }

  const result = shortestPath(from.id, to.id, { kinds, maxHops });
  if (!result) {
    return jsonResponse({
      from: { slug: from.slug, title: from.title },
      to: { slug: to.slug, title: to.title },
      maxHops,
      kinds,
      found: false,
    });
  }

  const path = result.ids
    .map((id) => corpus.byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map(slim);

  return jsonResponse({
    from: { slug: from.slug, title: from.title },
    to: { slug: to.slug, title: to.title },
    maxHops,
    kinds,
    found: true,
    hops: result.steps.length,
    cost: Number(result.cost.toFixed(4)),
    path,
    steps: result.steps.map((s) => ({
      from: corpus.byId.get(s.from)?.slug,
      to: corpus.byId.get(s.to)?.slug,
      w: Number(s.w.toFixed(4)),
      kinds: s.kinds,
    })),
  });
}
