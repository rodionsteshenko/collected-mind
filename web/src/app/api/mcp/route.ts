import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { corpus } from "@/lib/advisor/corpus";
import { embedQuery } from "@/lib/advisor/embed";
import { applyFilters, slim, sortBy, type Filters, type Sort } from "@/lib/corpus/api";
import { analogy, bridge, mmr, triangulate } from "@/lib/corpus/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function asText(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "collected-mind", version: "0.1.0" });

  server.registerTool(
    "search_text",
    {
      description:
        "Fuzzy keyword search across concept title, oneLiner, and aha. Best for named things you can spell.",
      inputSchema: {
        query: z.string(),
        k: z.number().int().min(1).max(80).default(15),
        form: z.string().optional(),
        domain: z.string().optional(),
        affect: z.string().optional(),
      },
    },
    async ({ query, k, form, domain, affect }) => {
      const filters: Filters = { form, domain, affect };
      const hits = corpus.search.search(query);
      const out: Record<string, unknown>[] = [];
      for (const h of hits) {
        const c = corpus.byId.get(h.id as number);
        if (!c) continue;
        if (!applyFilters([c], filters).length) continue;
        out.push({ ...slim(c), score: Number((h.score as number).toFixed(4)) });
        if (out.length >= k) break;
      }
      return asText(out);
    },
  );

  server.registerTool(
    "search_semantic",
    {
      description:
        "Embedding cosine similarity search. Best for fuzzy conceptual matches. Set mmr=true for diversified results.",
      inputSchema: {
        query: z.string(),
        k: z.number().int().min(1).max(80).default(15),
        form: z.string().optional(),
        domain: z.string().optional(),
        affect: z.string().optional(),
        mmr: z.boolean().default(false),
        lambda: z.number().min(0).max(1).default(0.5),
      },
    },
    async ({ query, k, form, domain, affect, mmr: useMmr, lambda }) => {
      const filters: Filters = { form, domain, affect };
      const v = await embedQuery(query);
      const hasFilters = Object.values(filters).some((x) => x !== undefined);
      if (useMmr) {
        const pool = Math.min(corpus.embIds.length, Math.max(k * 8, 80));
        const ranked = mmr(v, k * (hasFilters ? 4 : 1), lambda, pool);
        const out: Record<string, unknown>[] = [];
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
        return asText(out);
      }
      const candidateK = hasFilters ? Math.min(corpus.embIds.length, k * 8) : k;
      const hits = corpus.cosineTopK(v, candidateK);
      const out: Record<string, unknown>[] = [];
      for (const h of hits) {
        const c = corpus.byId.get(h.id);
        if (!c) continue;
        if (!applyFilters([c], filters).length) continue;
        out.push({ ...slim(c), score: Number(h.score.toFixed(4)) });
        if (out.length >= k) break;
      }
      return asText(out);
    },
  );

  server.registerTool(
    "get_concept",
    {
      description: "Fetch a single concept's full payload (oneLiner + aha + canonical example) by slug.",
      inputSchema: { slug: z.string() },
    },
    async ({ slug }) => {
      const c = corpus.bySlug.get(slug);
      if (!c) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "not found", slug }) }], isError: true };
      return asText(c);
    },
  );

  server.registerTool(
    "filter_by_facet",
    {
      description:
        "Return concepts matching tag/facet filters. Optional sort: 'surprise' | 'obscurity' | 'title'. Paginated via offset.",
      inputSchema: {
        form: z.string().optional(),
        domain: z.string().optional(),
        affect: z.string().optional(),
        source: z.string().optional(),
        minObscurity: z.number().int().optional(),
        maxObscurity: z.number().int().optional(),
        minSurprise: z.number().int().optional(),
        maxSurprise: z.number().int().optional(),
        sort: z.enum(["surprise", "obscurity", "title"]).default("surprise"),
        k: z.number().int().min(1).max(200).default(40),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ sort, k, offset, ...filters }) => {
      const filtered = applyFilters(corpus.concepts, filters as Filters);
      const sorted = sortBy(filtered, sort as Sort);
      const page = sorted.slice(offset, offset + k);
      return asText({ total: filtered.length, count: page.length, results: page.map(slim) });
    },
  );

  server.registerTool(
    "neighbors",
    {
      description:
        "Graph neighbors of a concept by edge kind. Default kind is 'semantic_near'.",
      inputSchema: {
        slug: z.string(),
        k: z.number().int().min(1).max(50).default(10),
        kind: z
          .enum([
            "semantic_near",
            "semantic_dedup",
            "prerequisite_of",
            "specializes",
            "contrasts_with",
            "example_of",
            "same_phenomenon_different_frame",
          ])
          .default("semantic_near"),
      },
    },
    async ({ slug, k, kind }) => {
      const c = corpus.bySlug.get(slug);
      if (!c) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "not found", slug }) }], isError: true };
      const list = corpus.edges[String(c.id)]?.[kind] ?? [];
      const out: Record<string, unknown>[] = [];
      for (const e of list) {
        const n = corpus.byId.get(e.id);
        if (!n) continue;
        out.push({ ...slim(n), weight: e.w });
        if (out.length >= k) break;
      }
      return asText(out);
    },
  );

  server.registerTool(
    "bridge",
    {
      description:
        "Find concepts that bridge two seeds — score high on similarity to both, balanced. Useful for 'what connects A and B?'.",
      inputSchema: {
        from: z.string(),
        to: z.string(),
        k: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ from, to, k }) => {
      const a = corpus.bySlug.get(from);
      const b = corpus.bySlug.get(to);
      if (!a || !b) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "not found", from, to }) }], isError: true };
      const hits = bridge(a.id, b.id, k);
      const out = hits
        .map((h) => {
          const c = corpus.byId.get(h.id);
          if (!c) return null;
          return {
            ...slim(c),
            score: Number(h.score.toFixed(4)),
            simFrom: Number(h.simA.toFixed(4)),
            simTo: Number(h.simB.toFixed(4)),
          };
        })
        .filter(Boolean);
      return asText(out);
    },
  );

  server.registerTool(
    "triangulate",
    {
      description:
        "Concepts near the centroid of multiple seed slugs. Useful for 'what's between/around these N ideas?'.",
      inputSchema: {
        slugs: z.array(z.string()).min(2).max(8),
        k: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ slugs, k }) => {
      const ids: number[] = [];
      const missing: string[] = [];
      for (const s of slugs) {
        const c = corpus.bySlug.get(s);
        if (!c) missing.push(s);
        else ids.push(c.id);
      }
      if (missing.length) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "unknown slugs", missing }) }], isError: true };
      const hits = triangulate(ids, k);
      const out = hits
        .map((h) => {
          const c = corpus.byId.get(h.id);
          if (!c) return null;
          return { ...slim(c), score: Number(h.score.toFixed(4)) };
        })
        .filter(Boolean);
      return asText(out);
    },
  );

  server.registerTool(
    "analogy",
    {
      description:
        "Find the closest analog of a concept restricted to a different domain or form. 'Like X but in biology'.",
      inputSchema: {
        slug: z.string(),
        domain: z.string().optional(),
        form: z.string().optional(),
        k: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ slug, domain, form, k }) => {
      const c = corpus.bySlug.get(slug);
      if (!c) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "not found", slug }) }], isError: true };
      if (!domain && !form) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "domain or form required" }) }], isError: true };
      const hits = analogy(c.id, { domain, form, k });
      const out = hits
        .map((h) => {
          const cc = corpus.byId.get(h.id);
          if (!cc) return null;
          return { ...slim(cc), score: Number(h.score.toFixed(4)) };
        })
        .filter(Boolean);
      return asText(out);
    },
  );

  server.registerTool(
    "list_facets",
    {
      description: "List all available form/domain/affect/source values with counts.",
      inputSchema: {},
    },
    async () => {
      const form: Record<string, number> = {};
      const domain: Record<string, number> = {};
      const affect: Record<string, number> = {};
      const source: Record<string, number> = {};
      for (const c of corpus.concepts) {
        form[c.form] = (form[c.form] ?? 0) + 1;
        for (const d of c.domain) domain[d] = (domain[d] ?? 0) + 1;
        for (const a of c.affect) affect[a] = (affect[a] ?? 0) + 1;
        source[c.source] = (source[c.source] ?? 0) + 1;
      }
      const ent = (m: Record<string, number>) =>
        Object.entries(m).sort((a, b) => b[1] - a[1]);
      return asText({
        total: corpus.concepts.length,
        form: ent(form),
        domain: ent(domain),
        affect: ent(affect),
        source: ent(source),
      });
    },
  );

  return server;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function handle(req: Request) {
  await corpus.load();
  // Stateless: every request gets a fresh transport + server. The tools are
  // pure reads against an already-loaded corpus, so there's nothing to keep
  // session-scoped. This also avoids cross-request state in serverless.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildServer();
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  // Decorate with CORS headers for browser-based MCP clients.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v as string);
  return new Response(res.body, { status: res.status, headers });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
