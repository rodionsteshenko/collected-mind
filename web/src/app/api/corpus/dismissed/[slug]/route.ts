import { corpus } from "@/lib/advisor/corpus";
import { errorResponse, jsonResponse, optionsResponse } from "@/lib/corpus/api";
import { isDismissed, removeDismissed } from "@/lib/dismissed/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return jsonResponse({ slug, isDismissed: await isDismissed(slug) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  await corpus.load();
  if (!corpus.bySlug.has(slug)) return errorResponse(`concept '${slug}' not found`, 404);
  const removed = await removeDismissed(slug);
  return jsonResponse({ ok: true, removed });
}
