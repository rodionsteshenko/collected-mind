import fs from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), ".advisor-data");
const FILE = path.join(DIR, "log.jsonl");

export type Pick = {
  slug: string;
  title: string;
  oneLiner: string;
  domain: string[];
  form: string;
  obscurity: number;
  why: string;
};

export type LogEntry = {
  id: string;
  ts: number;
  situation: string;
  model?: string;
  framing: string;
  picks: Pick[];
};

export async function appendLog(entry: Omit<LogEntry, "id" | "ts">): Promise<LogEntry> {
  await fs.mkdir(DIR, { recursive: true });
  const ts = Date.now();
  const full: LogEntry = { id: String(ts), ts, ...entry };
  await fs.appendFile(FILE, JSON.stringify(full) + "\n", "utf8");
  return full;
}

export async function readLog(): Promise<LogEntry[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const out: LogEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as LogEntry);
      } catch {}
    }
    return out.sort((a, b) => b.ts - a.ts);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
