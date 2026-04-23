import { History } from "@/components/History";
import { loadConcepts } from "@/lib/data";

export const metadata = { title: "History · Collected Mind" };

export default async function HistoryPage() {
  const concepts = await loadConcepts();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your history</h1>
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
        Everything you've marked, stored in this browser only. Export it before clearing site data if you want it.
      </p>
      <History concepts={concepts} />
    </div>
  );
}
