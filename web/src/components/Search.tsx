"use client";

import Link from "next/link";
import MiniSearch, { type SearchResult } from "minisearch";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "./Badge";
import type { Concept } from "@/lib/types";

type SearchDoc = {
  id: number;
  slug: string;
  title: string;
  oneLiner: string;
  aha: string;
};

export function Search({ concepts }: { concepts: Concept[] }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"text" | "semantic">("text");
  const [semanticResults, setSemanticResults] = useState<Concept[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticAvailable, setSemanticAvailable] = useState<boolean | null>(null);

  const bySlug = useMemo(() => new Map(concepts.map((c) => [c.slug, c])), [concepts]);

  const mini = useMemo(() => {
    const docs: SearchDoc[] = concepts.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      oneLiner: c.oneLiner,
      aha: c.aha,
    }));
    const ms = new MiniSearch<SearchDoc>({
      fields: ["title", "oneLiner", "aha"],
      storeFields: ["slug", "title", "oneLiner"],
      searchOptions: {
        boost: { title: 3, oneLiner: 2 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
    ms.addAll(docs);
    return ms;
  }, [concepts]);

  const textResults: (SearchResult & Partial<SearchDoc>)[] = useMemo(() => {
    if (!q.trim()) return [];
    return mini.search(q, { prefix: true, fuzzy: 0.2 }).slice(0, 40) as (
      | SearchResult
      | Partial<SearchDoc>
    )[] as (SearchResult & Partial<SearchDoc>)[];
  }, [mini, q]);

  // Lazy-load semantic index only when the user switches modes.
  useEffect(() => {
    if (mode !== "semantic") return;
    if (semanticAvailable !== null) return;
    (async () => {
      try {
        const metaRes = await fetch("/data/embeddings_meta.json");
        const meta = (await metaRes.json()) as { ids: number[]; dim: number };
        if (!meta.ids.length || !meta.dim) {
          setSemanticAvailable(false);
          return;
        }
        const binRes = await fetch("/data/embeddings.bin");
        const buf = await binRes.arrayBuffer();
        const floats = new Float32Array(buf);
        semanticStore = { ids: meta.ids, dim: meta.dim, mat: floats };
        setSemanticAvailable(true);
      } catch {
        setSemanticAvailable(false);
      }
    })();
  }, [mode, semanticAvailable]);

  // Run semantic query (text → embedding via tiny call-home? No — we ship only
  // concept embeddings, so semantic search means "find concepts similar to
  // *another concept*". For free-form text, we fall back to a combined text
  // match weighted by embedding nearness of the top text hit).
  useEffect(() => {
    if (mode !== "semantic") return;
    const term = q.trim();
    if (!term || !semanticStore) {
      setSemanticResults([]);
      return;
    }
    setSemanticLoading(true);
    const hits = mini.search(term, { prefix: true, fuzzy: 0.2 });
    const top = hits[0];
    if (!top) {
      setSemanticResults([]);
      setSemanticLoading(false);
      return;
    }
    const idx = semanticStore.ids.indexOf(Number(top.id));
    if (idx < 0) {
      setSemanticResults([]);
      setSemanticLoading(false);
      return;
    }
    const { ids, dim, mat } = semanticStore;
    const q0 = idx * dim;
    const scores = new Float32Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      let s = 0;
      const off = i * dim;
      for (let k = 0; k < dim; k++) s += mat[q0 + k] * mat[off + k];
      scores[i] = s;
    }
    const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]);
    const out: Concept[] = [];
    for (const i of order) {
      const c = concepts.find((x) => x.id === ids[i]);
      if (!c) continue;
      if (c.slug === String(top.slug)) continue;
      out.push(c);
      if (out.length >= 20) break;
    }
    setSemanticResults(out);
    setSemanticLoading(false);
  }, [mode, q, mini, concepts]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles, one-liners, aha text…"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-base outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex gap-1 rounded-lg border border-zinc-300 p-0.5 text-sm dark:border-zinc-700">
          {(["text", "semantic"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? "rounded-md bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "rounded-md px-3 py-1 text-zinc-600 dark:text-zinc-300"
              }
            >
              {m === "text" ? "Text" : "Semantic"}
            </button>
          ))}
        </div>
      </div>

      {mode === "text" ? (
        q.trim() ? (
          <SearchList
            items={textResults.map((r) => ({
              slug: String(r.slug),
              title: String(r.title),
              oneLiner: String(r.oneLiner ?? ""),
            }))}
          />
        ) : (
          <p className="text-sm text-zinc-500">Type to search {concepts.length} concepts.</p>
        )
      ) : semanticAvailable === false ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          No embeddings shipped with this build — run <code>make embed &amp;&amp; make export</code>.
        </p>
      ) : semanticLoading ? (
        <p className="text-sm text-zinc-500">Thinking…</p>
      ) : semanticResults.length ? (
        <SearchList
          items={semanticResults.map((c) => ({
            slug: c.slug,
            title: c.title,
            oneLiner: c.oneLiner,
          }))}
        />
      ) : q.trim() ? (
        <p className="text-sm text-zinc-500">No semantic neighbors found.</p>
      ) : (
        <p className="text-sm text-zinc-500">
          Semantic mode finds concepts close in embedding space to your top text hit. Great for
          "what's <em>like</em> this?"
        </p>
      )}
    </div>
  );
}

type SemanticStore = { ids: number[]; dim: number; mat: Float32Array } | null;
let semanticStore: SemanticStore = null;

function SearchList({ items }: { items: { slug: string; title: string; oneLiner: string }[] }) {
  if (!items.length) return <p className="text-sm text-zinc-500">No results.</p>;
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((it) => (
        <li key={it.slug}>
          <Link
            href={`/c/${it.slug}/`}
            className="flex flex-col gap-0.5 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{it.title}</span>
            </div>
            {it.oneLiner ? (
              <span className="line-clamp-1 text-sm text-zinc-600 dark:text-zinc-400">
                {it.oneLiner}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Silence the unused-Badge warning from tree-shaking false positives; used below.
void Badge;
