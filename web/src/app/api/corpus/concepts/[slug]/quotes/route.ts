import { corpus } from "@/lib/advisor/corpus";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/corpus/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  await corpus.load();
  const c = corpus.bySlug.get(slug);
  if (!c) return errorResponse(`concept '${slug}' not found`, 404);
  const quotes = corpus.quotes[String(c.id)] ?? [];
  return jsonResponse({
    slug: c.slug,
    title: c.title,
    count: quotes.length,
    quotes,
  });
}
