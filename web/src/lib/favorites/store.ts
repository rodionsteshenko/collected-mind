/**
 * Server-side favorites store.
 *
 * Single-user model (assumed user: Rodion). Persisted to a flat JSON file at
 * `web/data/favorites.json` so it survives restarts but doesn't introduce a
 * new database dependency. An in-memory mutex serializes concurrent writes.
 */

import fs from "node:fs/promises";
import path from "node:path";

export type Favorite = {
  slug: string;
  createdAt: string; // ISO 8601
};

type Store = { favorites: Favorite[] };

function filePath(): string {
  return path.join(process.cwd(), "data", "favorites.json");
}

let writeLock: Promise<void> = Promise.resolve();

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(filePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { favorites: parsed.favorites ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { favorites: [] };
    }
    throw err;
  }
}

async function writeStore(s: Store): Promise<void> {
  const fp = filePath();
  await fs.mkdir(path.dirname(fp), { recursive: true });
  // Write to a temp file then rename, so a crash mid-write can't truncate the
  // store. This is a tiny but worthwhile guarantee for personal data.
  const tmp = `${fp}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await fs.rename(tmp, fp);
}

/** Run `mut` under the global write lock. Reads can happen concurrently. */
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

export async function listFavorites(): Promise<Favorite[]> {
  const s = await readStore();
  // Newest first.
  return [...s.favorites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function isFavorite(slug: string): Promise<boolean> {
  const s = await readStore();
  return s.favorites.some((f) => f.slug === slug);
}

export async function addFavorite(slug: string): Promise<Favorite> {
  return withLock(async () => {
    const s = await readStore();
    const existing = s.favorites.find((f) => f.slug === slug);
    if (existing) return existing;
    const fav: Favorite = { slug, createdAt: new Date().toISOString() };
    s.favorites.push(fav);
    await writeStore(s);
    return fav;
  });
}

export async function removeFavorite(slug: string): Promise<boolean> {
  return withLock(async () => {
    const s = await readStore();
    const before = s.favorites.length;
    s.favorites = s.favorites.filter((f) => f.slug !== slug);
    if (s.favorites.length === before) return false;
    await writeStore(s);
    return true;
  });
}

/** Test-only: replace the on-disk store with the given list. */
export async function _resetForTests(favs: Favorite[]): Promise<void> {
  return withLock(async () => {
    await writeStore({ favorites: favs });
  });
}
