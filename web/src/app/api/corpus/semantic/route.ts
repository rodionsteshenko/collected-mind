import { corpus } from "@/lib/advisor/corpus";
import { embedQuery } from "@/lib/advisor/embed";
import {
  applyFilters,
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  parseFilters,
  slim,
} from "@/lib/corpus/api";
import { mmr } from "@/lib/corpus/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const useMmr = sp.get("mmr") === "1" || sp.get("mmr") === "true";
  const lambdaRaw = Number(sp.get("lambda"));
  const lambda = Number.isFinite(lambdaRaw) ? Math.max(0, Math.min(1, lambdaRaw)) : 0.5;

  const v = await embedQuery(q);
  const hasFilters = Object.values(filters).some((x) => x !== undefined);

  if (useMmr) {
    const pool = Math.min(corpus.embIds.length, Math.max(k * 8, 80));
    const ranked = mmr(v, k * (hasFilters ? 4 : 1), lambda, pool);
    const out: ({ score: number; relevance: number } & ReturnType<typeof slim>)[] = [];
    for (const h of ranked) {
      const c = corpus.byId.get(h.id);
      if (!c) continue;
      if (!applyFilters([c], filters).length) continue;
      out.push({
        ...slim(c),
        score: Number(h.score.toFixed(4)),
        relevance: Number(h.relevance.toFixed(4)),
      });
      if (out.length >= k) break;
    }
    return jsonResponse({ q, k, mmr: true, lambda, count: out.length, results: out });
  }

  const candidateK = hasFilters ? Math.min(corpus.embIds.length, k * 8) : k;
  const hits = corpus.cosineTopK(v, candidateK);
  const out: ({ score: number } & ReturnType<typeof slim>)[] = [];
  for (const h of hits) {
    const c = corpus.byId.get(h.id);
    if (!c) continue;
    if (!applyFilters([c], filters).length) continue;
    out.push({ ...slim(c), score: Number(h.score.toFixed(4)) });
    if (out.length >= k) break;
  }
  return jsonResponse({ q, k, count: out.length, results: out });
}
