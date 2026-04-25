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
import { weightedSample } from "@/lib/corpus/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  await corpus.load();
  const sp = new URL(req.url).searchParams;
  const k = clampInt(sp.get("k"), 10, 1, 100);

  const surpriseTempRaw = Number(sp.get("surpriseTemp"));
  const surpriseTemp = Number.isFinite(surpriseTempRaw) ? surpriseTempRaw : 1;
  const obscurityTempRaw = Number(sp.get("obscurityTemp"));
  const obscurityTemp = Number.isFinite(obscurityTempRaw) ? obscurityTempRaw : 0.5;

  const filters = parseFilters(sp);
  let pool = applyFilters(corpus.concepts, filters).map((c) => c.id);

  // Optional anchor: restrict pool to top-`anchorPool` cosine neighbors of the seed.
  const anchorSlug = (sp.get("anchor") ?? "").trim();
  if (anchorSlug) {
    const seed = corpus.bySlug.get(anchorSlug);
    if (!seed) return errorResponse(`anchor concept '${anchorSlug}' not found`, 404);
    const anchorPool = clampInt(sp.get("anchorPool"), 200, 10, 1000);
    const seedEmb = corpus.embeddingForId(seed.id);
    if (seedEmb) {
      const top = corpus.cosineTopK(seedEmb, anchorPool);
      const allowed = new Set(pool);
      pool = top.map((h) => h.id).filter((id) => id !== seed.id && allowed.has(id));
    }
  }

  if (pool.length === 0) {
    return jsonResponse({ k, surpriseTemp, obscurityTemp, count: 0, results: [] });
  }

  const picked = weightedSample(pool, k, { surpriseTemp, obscurityTemp });
  const results = picked
    .map((id) => corpus.byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map(slim);

  return jsonResponse({
    k,
    surpriseTemp,
    obscurityTemp,
    anchor: anchorSlug || null,
    count: results.length,
    results,
  });
}
