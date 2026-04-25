import { corpus } from "@/lib/advisor/corpus";
import { jsonResponse, optionsResponse } from "@/lib/corpus/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Counts = Record<string, number>;

function bumpEach(counts: Counts, values: string[]) {
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
}

function bump(counts: Counts, value: string) {
  counts[value] = (counts[value] ?? 0) + 1;
}

function toEntries(counts: Counts): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  await corpus.load();
  const form: Counts = {};
  const domain: Counts = {};
  const affect: Counts = {};
  const source: Counts = {};
  const obscurity: Record<number, number> = {};
  const surprise: Record<number, number> = {};

  for (const c of corpus.concepts) {
    bump(form, c.form);
    bumpEach(domain, c.domain);
    bumpEach(affect, c.affect);
    bump(source, c.source);
    obscurity[c.obscurity] = (obscurity[c.obscurity] ?? 0) + 1;
    surprise[c.surprise] = (surprise[c.surprise] ?? 0) + 1;
  }

  return jsonResponse({
    total: corpus.concepts.length,
    form: toEntries(form),
    domain: toEntries(domain),
    affect: toEntries(affect),
    source: toEntries(source),
    obscurity: Object.entries(obscurity)
      .map(([k, v]) => [Number(k), v] as [number, number])
      .sort((a, b) => a[0] - b[0]),
    surprise: Object.entries(surprise)
      .map(([k, v]) => [Number(k), v] as [number, number])
      .sort((a, b) => a[0] - b[0]),
  });
}
