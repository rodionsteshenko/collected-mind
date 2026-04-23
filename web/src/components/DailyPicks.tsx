"use client";

import { useEffect, useState } from "react";

import { ConceptCard } from "./ConceptCard";
import { pickDaily } from "@/lib/picker";
import { subscribe } from "@/lib/signals";
import type { Concept } from "@/lib/types";

export function DailyPicks({ concepts }: { concepts: Concept[] }) {
  const [picks, setPicks] = useState<Concept[] | null>(null);

  useEffect(() => {
    const refresh = () => setPicks(pickDaily(concepts, 4));
    refresh();
    return subscribe(refresh);
  }, [concepts]);

  if (!picks) {
    // Render skeletons until signals are read (avoids SSR/CSR mismatch).
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {picks.map((c) => (
        <ConceptCard key={c.id} concept={c} />
      ))}
    </div>
  );
}
