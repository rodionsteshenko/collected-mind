import Link from "next/link";

import type { Concept } from "@/lib/types";
import { Badge } from "./Badge";
import { label } from "@/lib/labels";

export function ConceptCard({
  concept,
  compact = false,
}: {
  concept: Concept;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/c/${concept.slug}/`}
      className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 group-hover:text-black dark:text-zinc-100 dark:group-hover:text-white">
          {concept.title}
        </h3>
        <Badge tone="violet" className="shrink-0">
          {label("form", concept.form)}
        </Badge>
      </div>
      <p
        className={
          compact
            ? "mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300"
            : "mt-2 text-sm text-zinc-600 dark:text-zinc-300"
        }
      >
        {concept.oneLiner}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {concept.domain.slice(0, 2).map((d) => (
          <Badge key={d} tone="indigo">
            {label("domain", d)}
          </Badge>
        ))}
        {concept.affect.slice(0, 1).map((a) => (
          <Badge key={a} tone="amber">
            {label("affect", a)}
          </Badge>
        ))}
        <Badge tone="zinc">obscurity {concept.obscurity}</Badge>
      </div>
    </Link>
  );
}
