import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { corpus } from "./corpus";
import { embedQuery } from "./embed";

export type ToolEvent = {
  tool: string;
  args: Record<string, unknown>;
  resultSummary: string;
};

function slim(id: number) {
  const c = corpus.byId.get(id);
  if (!c) return null;
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    oneLiner: c.oneLiner,
    domain: c.domain,
    form: c.form,
  };
}

export function buildMcpServer(onToolUse: (ev: ToolEvent) => void) {
  const searchSemantic = tool(
    "search_semantic",
    "Embed the query string and return top-k concepts by cosine similarity against the user's library. Best for fuzzy conceptual matches.",
    {
      query: z.string(),
      k: z.number().int().min(1).max(40).default(15),
    },
    async ({ query, k }) => {
      const q = await embedQuery(query);
      const hits = corpus.cosineTopK(q, k);
      const rows = hits.map((h) => ({ ...slim(h.id), score: Number(h.score.toFixed(4)) }));
      onToolUse({
        tool: "search_semantic",
        args: { query, k },
        resultSummary: `${rows.length} hits, top: ${rows[0]?.title ?? "—"}`,
      });
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  const searchText = tool(
    "search_text",
    "Keyword/prefix search across concept title, oneLiner, and aha. Use for named things.",
    {
      query: z.string(),
      k: z.number().int().min(1).max(40).default(15),
    },
    async ({ query, k }) => {
      const hits = corpus.search.search(query).slice(0, k);
      const rows = hits.map((h) => ({ ...slim(h.id as number), score: Number(h.score.toFixed(4)) }));
      onToolUse({
        tool: "search_text",
        args: { query, k },
        resultSummary: `${rows.length} hits`,
      });
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  const getConcept = tool(
    "get_concept",
    "Fetch a single concept in full — aha + canonical_example. Use to verify fit before recommending.",
    { slug: z.string() },
    async ({ slug }) => {
      const c = corpus.bySlug.get(slug);
      onToolUse({
        tool: "get_concept",
        args: { slug },
        resultSummary: c ? c.title : "not found",
      });
      if (!c) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "not found", slug }) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(c) }] };
    },
  );

  const filterByFacet = tool(
    "filter_by_facet",
    "Return up to `k` concepts matching optional domain and/or form filters.",
    {
      domain: z.string().optional(),
      form: z.string().optional(),
      k: z.number().int().min(1).max(80).default(40),
    },
    async ({ domain, form, k }) => {
      const rows = corpus.concepts.filter((c) => {
        if (domain && !c.domain.includes(domain)) return false;
        if (form && c.form !== form) return false;
        return true;
      });
      rows.sort((a, b) => b.surprise - a.surprise);
      const out = rows.slice(0, k).map((c) => slim(c.id));
      onToolUse({
        tool: "filter_by_facet",
        args: { domain, form, k },
        resultSummary: `${out.length} matches`,
      });
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    },
  );

  return createSdkMcpServer({
    name: "corpus",
    version: "0.1.0",
    tools: [searchSemantic, searchText, getConcept, filterByFacet],
  });
}

export const TOOL_NAMES = [
  "mcp__corpus__search_semantic",
  "mcp__corpus__search_text",
  "mcp__corpus__get_concept",
  "mcp__corpus__filter_by_facet",
];
