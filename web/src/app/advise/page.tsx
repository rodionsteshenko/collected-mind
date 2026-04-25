import { Advisor } from "@/components/Advisor";

export const metadata = { title: "Advise · Collected Mind" };

export default function AdvisePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Describe a situation</h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
          The advisor searches your library from several angles, verifies candidates, and returns the concepts most likely to frame what's going on. Runs locally through the Claude Agent SDK.
        </p>
      </div>
      <Advisor />
    </div>
  );
}
