import { corpus } from "@/lib/advisor/corpus";
import { errorResponse, jsonResponse, optionsResponse, slim } from "@/lib/corpus/api";
import { triangulate } from "@/lib/corpus/retrieval";
import { addFavorite, listFavorites } from "@/lib/favorites/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

/**
 * GET /api/corpus/favorites?k=12
 * Returns the favorited concepts (newest first) and a "more like these" list
 * computed from the centroid of their embeddings.
 */
export async function GET(req: Request) {
  await corpus.load();
  const sp = new URL(req.url).searchParams;
  const kRaw = Number(sp.get("k") ?? "12");
  const k = Number.isFinite(kRaw) ? Math.max(0, Math.min(50, kRaw)) : 12;

  const favs = await listFavorites();
  const concepts = favs
    .map((f) => corpus.bySlug.get(f.slug))
    .filter((c): c is NonNullable<typeof c> => c != null);

  let similar: ReturnType<typeof slim>[] = [];
  if (concepts.length > 0 && k > 0) {
    const ids = concepts.map((c) => c.id);
    const ranked = triangulate(ids, k);
    similar = ranked
      .map((r) => corpus.byId.get(r.id))
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map(slim);
  }

  return jsonResponse({
    count: favs.length,
    favorites: concepts.map((c, i) => ({ ...slim(c), favoritedAt: favs[i].createdAt })),
    similar,
  });
}

/** POST /api/corpus/favorites  body: { slug } */
export async function POST(req: Request) {
  let body: { slug?: string };
  try {
    body = (await req.json()) as { slug?: string };
  } catch {
    return errorResponse("invalid JSON body", 400);
  }
  const slug = body?.slug;
  if (!slug || typeof slug !== "string") return errorResponse("missing 'slug' in body", 400);

  await corpus.load();
  if (!corpus.bySlug.has(slug)) return errorResponse(`concept '${slug}' not found`, 404);

  const fav = await addFavorite(slug);
  return jsonResponse({ ok: true, favorite: fav }, { status: 201 });
}
