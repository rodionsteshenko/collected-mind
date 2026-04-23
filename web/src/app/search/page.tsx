import { Search } from "@/components/Search";
import { loadConcepts } from "@/lib/data";

export const metadata = { title: "Search · Collected Mind" };

export default async function SearchPage() {
  const concepts = await loadConcepts();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
      <Search concepts={concepts} />
    </div>
  );
}
