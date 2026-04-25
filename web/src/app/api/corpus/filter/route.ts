import { corpus } from "@/lib/advisor/corpus";
import {
  applyFilters,
  clampInt,
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

export async function GET(req: Request) {
  await corpus.load();
  const sp = new URL(req.url).searchParams;
  const k = clampInt(sp.get("k"), 40, 1, 200);
  const offset = clampInt(sp.get("offset"), 0, 0, 10_000);
  const filters = parseFilters(sp);
  const sort = parseSort(sp);

  const filtered = applyFilters(corpus.concepts, filters);
  const sorted = sortBy(filtered, sort);
  const page = sorted.slice(offset, offset + k);

  return jsonResponse({
    filters,
    sort,
    k,
    offset,
    total: filtered.length,
    count: page.length,
    results: page.map(slim),
  });
}
