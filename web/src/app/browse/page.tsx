import { Browser } from "@/components/Browser";
import { loadConcepts, loadTags } from "@/lib/data";

export const metadata = { title: "Browse · Collected Mind" };

export default async function BrowsePage() {
  const [concepts, tags] = await Promise.all([loadConcepts(), loadTags()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Browse</h1>
      <Browser concepts={concepts} tags={tags} />
    </div>
  );
}
