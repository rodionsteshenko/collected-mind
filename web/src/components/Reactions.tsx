"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

type State = "favorited" | "dismissed" | null;

export function Reactions({ slug }: { slug: string }) {
  const [state, setState] = useState<State | "loading">("loading");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/corpus/favorites/${encodeURIComponent(slug)}`).then((r) => r.json()),
      fetch(`/api/corpus/dismissed/${encodeURIComponent(slug)}`).then((r) => r.json()),
    ])
      .then(([f, d]: [{ isFavorite?: boolean }, { isDismissed?: boolean }]) => {
        if (cancelled) return;
        if (f.isFavorite) setState("favorited");
        else if (d.isDismissed) setState("dismissed");
        else setState(null);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const toggle = async (target: "favorited" | "dismissed") => {
    if (state === "loading" || pending) return;
    const current = state;
    const next: State = current === target ? null : target;
    setPending(true);
    setState(next);
    try {
      // If switching from one bucket to the other, clear the previous one first.
      if (current === "favorited" && target === "dismissed") {
        await fetch(`/api/corpus/favorites/${encodeURIComponent(slug)}`, { method: "DELETE" });
      } else if (current === "dismissed" && target === "favorited") {
        await fetch(`/api/corpus/dismissed/${encodeURIComponent(slug)}`, { method: "DELETE" });
      }
      if (next === "favorited") {
        await fetch(`/api/corpus/favorites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });
      } else if (next === "dismissed") {
        await fetch(`/api/corpus/dismissed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });
      } else {
        // toggling off — already deleted above if needed, else delete the matching bucket
        const url =
          current === "favorited"
            ? `/api/corpus/favorites/${encodeURIComponent(slug)}`
            : `/api/corpus/dismissed/${encodeURIComponent(slug)}`;
        await fetch(url, { method: "DELETE" });
      }
    } catch {
      setState(current);
    } finally {
      setPending(false);
    }
  };

  const isFav = state === "favorited";
  const isDis = state === "dismissed";
  const disabled = state === "loading" || pending;

  return (
    <div className="flex flex-wrap gap-2" aria-label="Mark this concept">
      <button
        type="button"
        onClick={() => toggle("favorited")}
        disabled={disabled}
        aria-pressed={isFav}
        aria-label={isFav ? "Unfavorite" : "Favorite"}
        title={isFav ? "Remove from favorites" : "Mark as favorite"}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95",
          isFav
            ? "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:hover:bg-rose-900/60"
            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
          disabled && "opacity-60",
        )}
      >
        <span aria-hidden className={isFav ? "text-rose-500" : "text-zinc-400"}>
          {isFav ? "♥" : "♡"}
        </span>
        <span>{isFav ? "Favorited" : "Favorite"}</span>
      </button>

      <button
        type="button"
        onClick={() => toggle("dismissed")}
        disabled={disabled}
        aria-pressed={isDis}
        aria-label={isDis ? "Un-dismiss" : "Mark as not important"}
        title={isDis ? "Un-dismiss" : "Not important to me"}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition active:scale-95",
          isDis
            ? "bg-zinc-300 text-zinc-700 hover:bg-zinc-400 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
          disabled && "opacity-60",
        )}
      >
        <span aria-hidden className={isDis ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400"}>
          {isDis ? "☹" : "☹"}
        </span>
        <span>{isDis ? "Dismissed" : "Not important"}</span>
      </button>
    </div>
  );
}
