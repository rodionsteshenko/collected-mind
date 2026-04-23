"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

import { getSignal, setSignal, subscribe } from "@/lib/signals";
import type { Signal } from "@/lib/types";

const OPTIONS: { key: Signal; label: string; tone: string }[] = [
  { key: "knew", label: "Knew this", tone: "bg-zinc-200 dark:bg-zinc-700" },
  { key: "didnt", label: "Didn't know", tone: "bg-indigo-200 dark:bg-indigo-700" },
  { key: "mind_blown", label: "Blew my mind", tone: "bg-rose-300 dark:bg-rose-700" },
];

export function SignalButtons({ slug }: { slug: string }) {
  const [active, setActive] = useState<Signal | null>(null);
  useEffect(() => {
    setActive(getSignal(slug));
    return subscribe(() => setActive(getSignal(slug)));
  }, [slug]);

  const onClick = (key: Signal) => {
    setSignal(slug, active === key ? null : key);
  };

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Your reaction">
      {OPTIONS.map((o) => {
        const selected = active === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onClick(o.key)}
            className={clsx(
              "rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95",
              selected
                ? `${o.tone} text-zinc-900 dark:text-white shadow-inner`
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
