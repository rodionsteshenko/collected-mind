import { corpus } from "@/lib/advisor/corpus";
import { errorResponse, jsonResponse, optionsResponse, slim } from "@/lib/corpus/api";
import { addDismissed, listDismissed } from "@/lib/dismissed/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return optionsResponse();
}

/** GET /api/corpus/dismissed — list dismissed concepts (newest first). */
export async function GET() {
  await corpus.load();
  const items = await listDismissed();
  const concepts = items
    .map((d, i) => {
      const c = corpus.bySlug.get(d.slug);
      return c ? { ...slim(c), dismissedAt: items[i].createdAt } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c != null);
  return jsonResponse({ count: items.length, dismissed: concepts });
}

/** POST /api/corpus/dismissed  body: { slug } */
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

  const d = await addDismissed(slug);
  return jsonResponse({ ok: true, dismissed: d }, { status: 201 });
}
