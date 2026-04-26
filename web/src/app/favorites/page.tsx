import Link from "next/link";

import { ConceptCard } from "@/components/ConceptCard";
import { corpus } from "@/lib/advisor/corpus";
import { triangulate } from "@/lib/corpus/retrieval";
import { listFavorites } from "@/lib/favorites/store";
import type { Concept } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Favorites · Collected Mind",
  description: "Concepts you've marked as favorites, plus a 'more like these' set.",
};

export default async function FavoritesPage() {
  await corpus.load();
  const favs = await listFavorites();
  const favoriteConcepts: Concept[] = favs
    .map((f) => corpus.bySlug.get(f.slug))
    .filter((c): c is Concept => c != null);

  let similar: Concept[] = [];
  if (favoriteConcepts.length > 0) {
    const ids = favoriteConcepts.map((c) => c.id);
    const ranked = triangulate(ids, 12);
    similar = ranked
      .map((r) => corpus.byId.get(r.id))
      .filter((c): c is Concept => c != null);
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your favorites</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Concepts you&rsquo;ve marked with the heart. Open one to revisit it, or scroll down for
          ideas near the centroid of all your favorites.
        </p>
      </header>

      {favoriteConcepts.length === 0 ? (
        <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          No favorites yet. Find an idea you love on a{" "}
          <Link href="/browse/" className="underline hover:text-zinc-900 dark:hover:text-white">
            concept page
          </Link>{" "}
          and tap the heart.
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Favorited ({favoriteConcepts.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favoriteConcepts.map((c) => (
              <ConceptCard key={c.id} concept={c} />
            ))}
          </div>
        </section>
      )}

      {similar.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            More like these
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Closest to the centroid of your favorites&rsquo; embeddings.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {similar.map((c) => (
              <ConceptCard key={c.id} concept={c} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
