"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

import { ConceptCard } from "./ConceptCard";
import { label } from "@/lib/labels";
import type { Concept, Tags } from "@/lib/types";

type Facet = "form" | "domain" | "affect" | "source";

const FACETS: { key: Facet; label: string }[] = [
  { key: "form", label: "Form" },
  { key: "domain", label: "Domain" },
  { key: "affect", label: "Vibe" },
  { key: "source", label: "Source list" },
];

export function Browser({ concepts, tags }: { concepts: Concept[]; tags: Tags }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<Facet, Set<string>>>({
    form: new Set(),
    domain: new Set(),
    affect: new Set(),
    source: new Set(),
  });
  const [minObscurity, setMinObscurity] = useState(1);
  const [maxObscurity, setMaxObscurity] = useState(5);
  const [sort, setSort] = useState<"title" | "surprise" | "obscurity">("title");
  const [limit, setLimit] = useState(60);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pass = (c: Concept): boolean => {
      if (c.obscurity < minObscurity || c.obscurity > maxObscurity) return false;
      if (filters.form.size && !filters.form.has(c.form)) return false;
      if (filters.source.size && !filters.source.has(c.source)) return false;
      if (filters.domain.size && !c.domain.some((d) => filters.domain.has(d))) return false;
      if (filters.affect.size && !c.affect.some((a) => filters.affect.has(a))) return false;
      if (q) {
        const hay = `${c.title} ${c.oneLiner}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    const out = concepts.filter(pass);
    out.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "surprise") return b.surprise - a.surprise;
      return b.obscurity - a.obscurity;
    });
    return out;
  }, [concepts, query, filters, minObscurity, maxObscurity, sort]);

  const toggle = (facet: Facet, value: string) => {
    setFilters((prev) => {
      const next: typeof prev = {
        form: new Set(prev.form),
        domain: new Set(prev.domain),
        affect: new Set(prev.affect),
        source: new Set(prev.source),
      };
      if (next[facet].has(value)) next[facet].delete(value);
      else next[facet].add(value);
      return next;
    });
    setLimit(60);
  };

  const clearAll = () => {
    setFilters({
      form: new Set(),
      domain: new Set(),
      affect: new Set(),
      source: new Set(),
    });
    setQuery("");
    setMinObscurity(1);
    setMaxObscurity(5);
  };

  const anyFilter =
    query ||
    Object.values(filters).some((s) => s.size) ||
    minObscurity !== 1 ||
    maxObscurity !== 5;

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      {/* Filters */}
      <aside className="flex flex-col gap-4 text-sm">
        <div>
          <label htmlFor="browse-q" className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Filter
          </label>
          <input
            id="browse-q"
            type="search"
            placeholder="Filter by title or one-liner…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Obscurity: {minObscurity}–{maxObscurity}
          </div>
          <div className="flex gap-2">
            <input
              type="range"
              min={1}
              max={5}
              value={minObscurity}
              onChange={(e) => setMinObscurity(Math.min(Number(e.target.value), maxObscurity))}
              className="flex-1"
            />
            <input
              type="range"
              min={1}
              max={5}
              value={maxObscurity}
              onChange={(e) => setMaxObscurity(Math.max(Number(e.target.value), minObscurity))}
              className="flex-1"
            />
          </div>
        </div>

        {FACETS.map(({ key, label: title }) => (
          <fieldset key={key} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              {title}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {tags[key].slice(0, 30).map(([value, count]) => {
                const v = String(value);
                const selected = filters[key].has(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggle(key, v)}
                    className={clsx(
                      "rounded-full border px-2.5 py-1 text-xs transition",
                      selected
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
                    )}
                  >
                    {label(key, v)} <span className="text-zinc-400">{count}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        {anyFilter ? (
          <button
            type="button"
            onClick={clearAll}
            className="self-start rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Clear all
          </button>
        ) : null}
      </aside>

      {/* Results */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-300">
          <span>
            {filtered.length.toLocaleString()} of {concepts.length.toLocaleString()}
          </span>
          <label className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="title">Title</option>
              <option value="surprise">Surprise</option>
              <option value="obscurity">Obscurity</option>
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, limit).map((c) => (
            <ConceptCard key={c.id} concept={c} compact />
          ))}
        </div>
        {filtered.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + 60)}
            className="mx-auto rounded-full border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Load more ({filtered.length - limit} remaining)
          </button>
        )}
      </section>
    </div>
  );
}
