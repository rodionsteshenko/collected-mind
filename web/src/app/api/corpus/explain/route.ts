import { corpus } from "@/lib/advisor/corpus";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
  slim,
} from "@/lib/corpus/api";
import { explain } from "@/lib/corpus/retrieval";

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

  const exp = explain(from.id, to.id);
  if (!exp) return errorResponse("could not explain", 500);

  const sharedNeighbors = exp.sharedNeighbors
    .map((n) => {
      const c = corpus.byId.get(n.id);
      if (!c) return null;
      return { ...slim(c), via: n.via };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .slice(0, 25);

  return jsonResponse({
    from: { slug: from.slug, title: from.title, form: from.form, domain: from.domain, affect: from.affect },
    to: { slug: to.slug, title: to.title, form: to.form, domain: to.domain, affect: to.affect },
    cosine: exp.cosine == null ? null : Number(exp.cosine.toFixed(4)),
    directEdges: exp.directEdges.map((e) => ({ ...e, w: Number(e.w.toFixed(4)) })),
    sameForm: exp.sameForm,
    sameSource: exp.sameSource,
    sharedDomain: exp.sharedDomain,
    sharedAffect: exp.sharedAffect,
    sharedNeighbors,
  });
}
