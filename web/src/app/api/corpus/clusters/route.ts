import { corpus } from "@/lib/advisor/corpus";
import { jsonResponse, optionsResponse, slim } from "@/lib/corpus/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  await corpus.load();
  if (corpus.clusters.length === 0) {
    return jsonResponse({
      total: 0,
      message: "no clusters available — run `make cluster` to generate",
      clusters: [],
    });
  }
  const clusters = corpus.clusters.map((c) => ({
    id: c.id,
    size: c.size,
    topTerms: c.topTerms,
    representatives: c.representatives
      .map((id) => corpus.byId.get(id))
      .filter((x): x is NonNullable<typeof x> => x != null)
      .map(slim),
  }));
  clusters.sort((a, b) => b.size - a.size);
  return jsonResponse({ total: clusters.length, clusters });
}
