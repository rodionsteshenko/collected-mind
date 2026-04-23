"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { allSignals, subscribe } from "@/lib/signals";
import type { Concept } from "@/lib/types";

export function RecentMindBlown({ concepts }: { concepts: Concept[] }) {
  const bySlug = new Map(concepts.map((c) => [c.slug, c]));
  const [items, setItems] = useState<{ c: Concept; at: number }[] | null>(null);

  useEffect(() => {
    const refresh = () => {
      const sigs = allSignals();
      const out: { c: Concept; at: number }[] = [];
      for (const [slug, { signal, at }] of Object.entries(sigs)) {
        if (signal !== "mind_blown") continue;
        const c = bySlug.get(slug);
        if (c) out.push({ c, at });
      }
      out.sort((a, b) => b.at - a.at);
      setItems(out.slice(0, 8));
    };
    refresh();
    return subscribe(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items === null || items.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Recent mind-blown
      </h2>
      <ul className="flex flex-wrap gap-2">
        {items.map(({ c }) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.slug}/`}
              className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500"
            >
              {c.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
