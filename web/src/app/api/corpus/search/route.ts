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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  await corpus.load();
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (!q) return errorResponse("query parameter 'q' is required");
  const k = clampInt(sp.get("k"), 15, 1, 80);
  const filters = parseFilters(sp);

  const hits = corpus.search.search(q);
  const filtered = [];
  for (const h of hits) {
    const c = corpus.byId.get(h.id as number);
    if (!c) continue;
    if (!applyFilters([c], filters).length) continue;
    filtered.push({ ...slim(c), score: Number((h.score as number).toFixed(4)) });
    if (filtered.length >= k) break;
  }
  return jsonResponse({ q, k, count: filtered.length, results: filtered });
}
