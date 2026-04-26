import type { Concept } from "@/lib/types";

export type Slim = Pick<
  Concept,
  "id" | "slug" | "title" | "oneLiner" | "domain" | "form" | "affect" | "obscurity" | "surprise"
>;

export function slim(c: Concept): Slim {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    oneLiner: c.oneLiner,
    domain: c.domain,
    form: c.form,
    affect: c.affect,
    obscurity: c.obscurity,
    surprise: c.surprise,
  };
}

export type Filters = {
  form?: string;
  domain?: string;
  affect?: string;
  source?: string;
  minObscurity?: number;
  maxObscurity?: number;
  minSurprise?: number;
  maxSurprise?: number;
};

export function parseFilters(sp: URLSearchParams): Filters {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (k: string) => sp.get(k) || undefined;
  return {
    form: str("form"),
    domain: str("domain"),
    affect: str("affect"),
    source: str("source"),
    minObscurity: num("minObscurity"),
    maxObscurity: num("maxObscurity"),
    minSurprise: num("minSurprise"),
    maxSurprise: num("maxSurprise"),
  };
}

export function applyFilters(concepts: Concept[], f: Filters): Concept[] {
  return concepts.filter((c) => {
    if (f.form && c.form !== f.form) return false;
    if (f.domain && !c.domain.includes(f.domain)) return false;
    if (f.affect && !c.affect.includes(f.affect)) return false;
    if (f.source && c.source !== f.source) return false;
    if (f.minObscurity != null && c.obscurity < f.minObscurity) return false;
    if (f.maxObscurity != null && c.obscurity > f.maxObscurity) return false;
    if (f.minSurprise != null && c.surprise < f.minSurprise) return false;
    if (f.maxSurprise != null && c.surprise > f.maxSurprise) return false;
    return true;
  });
}

export type Sort = "surprise" | "obscurity" | "title";

export function parseSort(sp: URLSearchParams): Sort {
  const s = sp.get("sort");
  if (s === "obscurity" || s === "title") return s;
  return "surprise";
}

export function sortBy(concepts: Concept[], s: Sort): Concept[] {
  const out = concepts.slice();
  if (s === "surprise") out.sort((a, b) => b.surprise - a.surprise);
  else if (s === "obscurity") out.sort((a, b) => a.obscurity - b.obscurity);
  else out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export function clampInt(v: string | null, def: number, min: number, max: number): number {
  if (v == null || v === "") return def;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
      ...CORS_HEADERS,
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, { status });
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
