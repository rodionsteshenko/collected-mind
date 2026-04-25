import { corpus } from "@/lib/advisor/corpus";
import {
  errorResponse,
  jsonResponse,
  optionsResponse,
  slim,
} from "@/lib/corpus/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  await corpus.load();
  const { slug } = await params;
  const c = corpus.bySlug.get(slug);
  if (!c) return errorResponse(`concept '${slug}' not found`, 404);
  const label = corpus.clusterOfConcept.get(c.id);
  if (label == null) return errorResponse("no cluster assigned (run `make cluster`)", 404);
  const cluster = corpus.clusterById.get(label);
  if (!cluster) return errorResponse(`cluster ${label} not found`, 500);
  return jsonResponse({
    concept: { slug: c.slug, title: c.title },
    cluster: {
      id: cluster.id,
      size: cluster.size,
      topTerms: cluster.topTerms,
      representatives: cluster.representatives
        .map((rid) => corpus.byId.get(rid))
        .filter((x): x is NonNullable<typeof x> => x != null)
        .map(slim),
    },
  });
}
