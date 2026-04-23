"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "./Badge";
import { allSignals, exportJson, importJson, setSignal, subscribe } from "@/lib/signals";
import type { Concept, Signal } from "@/lib/types";

const LABELS: Record<Signal, string> = {
  knew: "Knew this",
  didnt: "Didn't know",
  mind_blown: "Blew my mind",
};

const TONE: Record<Signal, "zinc" | "indigo" | "rose"> = {
  knew: "zinc",
  didnt: "indigo",
  mind_blown: "rose",
};

export function History({ concepts }: { concepts: Concept[] }) {
  const [rows, setRows] = useState<
    { slug: string; signal: Signal; at: number; concept: Concept | undefined }[]
  >([]);
  const [filter, setFilter] = useState<"all" | Signal>("all");
  const bySlug = useMemo(() => new Map(concepts.map((c) => [c.slug, c])), [concepts]);

  useEffect(() => {
    const refresh = () => {
      const sigs = allSignals();
      const out: typeof rows = [];
      for (const [slug, { signal, at }] of Object.entries(sigs)) {
        out.push({ slug, signal, at, concept: bySlug.get(slug) });
      }
      out.sort((a, b) => b.at - a.at);
      setRows(out);
    };
    refresh();
    return subscribe(refresh);
  }, [bySlug]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.signal === filter);

  const counts: Record<Signal, number> = { knew: 0, didnt: 0, mind_blown: 0 };
  for (const r of rows) counts[r.signal]++;

  const onExport = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collected-mind-signals-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      const n = importJson(String(r.result ?? ""));
      if (n < 0) alert("Import failed — not valid JSON.");
    };
    r.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3 text-sm">
        <FilterTab label="All" active={filter === "all"} onClick={() => setFilter("all")} count={rows.length} />
        <FilterTab
          label="Blew my mind"
          active={filter === "mind_blown"}
          onClick={() => setFilter("mind_blown")}
          count={counts.mind_blown}
          tone="rose"
        />
        <FilterTab
          label="Didn't know"
          active={filter === "didnt"}
          onClick={() => setFilter("didnt")}
          count={counts.didnt}
          tone="indigo"
        />
        <FilterTab
          label="Knew this"
          active={filter === "knew"}
          onClick={() => setFilter("knew")}
          count={counts.knew}
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Export JSON
          </button>
          <label className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 cursor-pointer">
            Import
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing here yet. Mark some concepts on their pages and they'll show up.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {visible.map((r) => (
            <li key={r.slug} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                {r.concept ? (
                  <Link href={`/c/${r.slug}/`} className="font-medium hover:underline">
                    {r.concept.title}
                  </Link>
                ) : (
                  <span className="font-medium">{r.slug}</span>
                )}
                {r.concept?.oneLiner ? (
                  <div className="mt-0.5 line-clamp-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {r.concept.oneLiner}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={TONE[r.signal]}>{LABELS[r.signal]}</Badge>
                <button
                  type="button"
                  onClick={() => setSignal(r.slug, null)}
                  className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterTab({
  label,
  active,
  onClick,
  count,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
  tone?: "rose" | "indigo";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-zinc-900 px-3 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "rounded-full border border-zinc-300 px-3 py-1 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
      }
    >
      {label}{" "}
      <span className={active ? "text-zinc-300 dark:text-zinc-500" : "text-zinc-400"}>{count}</span>
      {tone ? (
        <span
          aria-hidden
          className={
            "ml-1 inline-block h-1.5 w-1.5 rounded-full " +
            (tone === "rose" ? "bg-rose-400" : "bg-indigo-400")
          }
        />
      ) : null}
    </button>
  );
}
