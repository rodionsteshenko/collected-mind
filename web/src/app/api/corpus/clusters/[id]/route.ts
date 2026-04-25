import { corpus } from "@/lib/advisor/corpus";
import {
  applyFilters,
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  parseFilters,
  parseSort,
  slim,
  sortBy,
} from "@/lib/corpus/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await corpus.load();
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return errorResponse(`invalid cluster id '${idStr}'`);
  const cluster = corpus.clusterById.get(id);
  if (!cluster) return errorResponse(`cluster ${id} not found`, 404);

  const sp = new URL(req.url).searchParams;
  const filters = parseFilters(sp);
  const sort = parseSort(sp);
  const k = clampInt(sp.get("k"), 50, 1, 500);
  const offset = clampInt(sp.get("offset"), 0, 0, 100000);

  const memberIds: number[] = [];
  for (const [cid, label] of corpus.clusterOfConcept) {
    if (label === id) memberIds.push(cid);
  }
  const members = memberIds
    .map((cid) => corpus.byId.get(cid))
    .filter((c): c is NonNullable<typeof c> => c != null);
  const filtered = applyFilters(members, filters);
  const sorted = sortBy(filtered, sort);
  const page = sorted.slice(offset, offset + k);

  return jsonResponse({
    id,
    size: cluster.size,
    topTerms: cluster.topTerms,
    representatives: cluster.representatives
      .map((rid) => corpus.byId.get(rid))
      .filter((x): x is NonNullable<typeof x> => x != null)
      .map(slim),
    total: filtered.length,
    count: page.length,
    offset,
    members: page.map(slim),
  });
}
