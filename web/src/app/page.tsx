import { DailyPicks } from "@/components/DailyPicks";
import { RecentMindBlown } from "@/components/RecentMindBlown";
import { loadConcepts, loadTags } from "@/lib/data";

export default async function Home() {
  const [concepts, tags] = await Promise.all([loadConcepts(), loadTags()]);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Four things worth thinking about today
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300 sm:text-base">
          {tags.total.toLocaleString()} concepts — biases, fallacies, paradoxes, thought experiments
          and named effects — scraped from Wikipedia and framed for quick "aha". Mark what
          stuck with you; the picker updates each day.
        </p>
      </section>

      <DailyPicks concepts={concepts} />

      <RecentMindBlown concepts={concepts} />
    </div>
  );
}
