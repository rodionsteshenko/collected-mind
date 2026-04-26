/**
 * Server-side "not important" / dismissed store.
 *
 * Mirror of `favorites/store.ts`. Same single-user (Rodion) model, same
 * atomic-write + in-memory-mutex strategy. Lives in `web/data/dismissed.json`.
 */

import fs from "node:fs/promises";
import path from "node:path";

export type Dismissed = {
  slug: string;
  createdAt: string;
};

type Store = { dismissed: Dismissed[] };

function filePath(): string {
  return path.join(process.cwd(), "data", "dismissed.json");
}

let writeLock: Promise<void> = Promise.resolve();

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(filePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { dismissed: parsed.dismissed ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { dismissed: [] };
    }
    throw err;
  }
}

async function writeStore(s: Store): Promise<void> {
  const fp = filePath();
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await fs.rename(tmp, fp);
}

async function withLock<T>(mut: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release: () => void = () => {};
  writeLock = new Promise<void>((r) => {
    release = r;
  });
  try {
    await prev;
    return await mut();
  } finally {
    release();
  }
}

export async function listDismissed(): Promise<Dismissed[]> {
  const s = await readStore();
  return [...s.dismissed].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function isDismissed(slug: string): Promise<boolean> {
  const s = await readStore();
  return s.dismissed.some((f) => f.slug === slug);
}

export async function addDismissed(slug: string): Promise<Dismissed> {
  return withLock(async () => {
    const s = await readStore();
    const existing = s.dismissed.find((f) => f.slug === slug);
    if (existing) return existing;
    const d: Dismissed = { slug, createdAt: new Date().toISOString() };
    s.dismissed.push(d);
    await writeStore(s);
    return d;
  });
}

export async function removeDismissed(slug: string): Promise<boolean> {
  return withLock(async () => {
    const s = await readStore();
    const before = s.dismissed.length;
    s.dismissed = s.dismissed.filter((f) => f.slug !== slug);
    if (s.dismissed.length === before) return false;
    await writeStore(s);
    return true;
  });
}

export async function _resetForTests(items: Dismissed[]): Promise<void> {
  return withLock(async () => {
    await writeStore({ dismissed: items });
  });
}
