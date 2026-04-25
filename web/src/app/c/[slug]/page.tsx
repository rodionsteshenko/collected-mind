import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/Badge";
import { EgoGraph } from "@/components/EgoGraph";
import { SignalButtons } from "@/components/SignalButtons";
import { loadConcepts, loadConceptsById, loadEdges } from "@/lib/data";
import { buildEgoGraph } from "@/lib/egoGraph";
import { label } from "@/lib/labels";
import type { Concept, EdgeKind } from "@/lib/types";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const concepts = await loadConcepts();
  return concepts.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const concepts = await loadConcepts();
  const c = concepts.find((x) => x.slug === slug);
  if (!c) return { title: "Not found · Collected Mind" };
  return {
    title: `${c.title} · Collected Mind`,
    description: c.oneLiner,
  };
}

const KIND_ORDER: EdgeKind[] = [
  "prerequisite_of",
  "contrasts_with",
  "specializes",
  "example_of",
  "same_phenomenon_different_frame",
  "semantic_near",
];

const KIND_LABELS: Record<EdgeKind, string> = {
  prerequisite_of: "Prerequisite for",
  semantic_near: "Related concepts",
  semantic_dedup: "Nearly the same as",
  specializes: "Specializes",
  contrasts_with: "Contrasts with",
  example_of: "Examples",
  same_phenomenon_different_frame: "Same idea, different frame",
};

export default async function ConceptPage({ params }: PageProps) {
  const { slug } = await params;
  const [concepts, byId, edges] = await Promise.all([
    loadConcepts(),
    loadConceptsById(),
    loadEdges(),
  ]);
  const concept = concepts.find((c) => c.slug === slug);
  if (!concept) notFound();

  const myEdges = edges[String(concept.id)] ?? {};

  // Prereqs: find concepts where I am the dst, kind=prerequisite_of
  const prereqs: Concept[] = [];
  for (const [srcId, kinds] of Object.entries(edges)) {
    const list = kinds.prerequisite_of ?? [];
    if (list.some((e) => e.id === concept.id)) {
      const c = byId.get(Number(srcId));
      if (c) prereqs.push(c);
    }
  }

  const seenRelatedIds = new Set<number>();
  for (const list of Object.values(myEdges)) {
    for (const e of list ?? []) seenRelatedIds.add(e.id);
  }
  for (const c of prereqs) seenRelatedIds.add(c.id);

  const ego = buildEgoGraph(concept, edges, byId);

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="violet">{label("form", concept.form)}</Badge>
          {concept.domain.map((d) => (
            <Badge key={d} tone="indigo">
              {label("domain", d)}
            </Badge>
          ))}
          {concept.affect.map((a) => (
            <Badge key={a} tone="amber">
              {label("affect", a)}
            </Badge>
          ))}
          <Badge tone="zinc">obscurity {concept.obscurity}</Badge>
          <Badge tone="rose">surprise {concept.surprise}/10</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{concept.title}</h1>
        <p className="max-w-3xl text-lg text-zinc-700 dark:text-zinc-300">{concept.oneLiner}</p>
      </header>

      <SignalButtons slug={concept.slug} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">The "aha"</h2>
        <p className="max-w-3xl text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
          {concept.aha}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Example</h2>
        <p className="max-w-3xl rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {concept.example}
        </p>
      </section>

      {ego.nodes.length > 1 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Neighborhood
          </h2>
          <EgoGraph nodes={ego.nodes} links={ego.links} />
        </section>
      ) : null}

      {prereqs.length ? (
        <Related
          title="You'll want to know first"
          items={prereqs.slice(0, 6)}
        />
      ) : null}

      {KIND_ORDER.map((kind) => {
        const list = myEdges[kind];
        if (!list || !list.length) return null;
        const items = list
          .map((e) => byId.get(e.id))
          .filter((c): c is Concept => !!c)
          .slice(0, 6);
        if (!items.length) return null;
        return <Related key={kind} title={KIND_LABELS[kind]} items={items} />;
      })}

      <footer className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4 text-sm text-zinc-500 dark:border-zinc-800">
        <a
          href={concept.wikiUrl}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Read on Wikipedia →
        </a>
        <span>·</span>
        <span>Source list: {label("source", concept.source)}</span>
      </footer>
    </article>
  );
}

function Related({ title, items }: { title: string; items: Concept[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((c) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.slug}/`}
              className="block rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-500"
            >
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{c.title}</div>
              {c.oneLiner ? (
                <div className="mt-1 line-clamp-1 text-zinc-600 dark:text-zinc-400">
                  {c.oneLiner}
                </div>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
