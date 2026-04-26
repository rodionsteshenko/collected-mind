import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetForTests,
  addFavorite,
  isFavorite,
  listFavorites,
  removeFavorite,
} from "@/lib/favorites/store";

let tmpDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "favorites-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterAll(async () => {
  cwdSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await _resetForTests([]);
});

describe("favorites store", () => {
  it("starts empty", async () => {
    expect(await listFavorites()).toEqual([]);
    expect(await isFavorite("anything")).toBe(false);
  });

  it("addFavorite persists and is idempotent", async () => {
    const a = await addFavorite("alpha");
    expect(a.slug).toBe("alpha");
    expect(typeof a.createdAt).toBe("string");

    const b = await addFavorite("alpha");
    expect(b.createdAt).toBe(a.createdAt); // same record returned

    const list = await listFavorites();
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe("alpha");
  });

  it("listFavorites returns newest first", async () => {
    await addFavorite("first");
    // Use a tiny delay to ensure distinct ISO timestamps.
    await new Promise((r) => setTimeout(r, 10));
    await addFavorite("second");
    const list = await listFavorites();
    expect(list.map((f) => f.slug)).toEqual(["second", "first"]);
  });

  it("removeFavorite returns true when present, false otherwise", async () => {
    await addFavorite("gamma");
    expect(await removeFavorite("gamma")).toBe(true);
    expect(await removeFavorite("gamma")).toBe(false);
    expect(await isFavorite("gamma")).toBe(false);
  });

  it("survives concurrent writes via the in-memory mutex", async () => {
    await Promise.all([
      addFavorite("a"),
      addFavorite("b"),
      addFavorite("c"),
      addFavorite("d"),
      addFavorite("a"), // duplicate
    ]);
    const list = await listFavorites();
    expect(list.map((f) => f.slug).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("writes are atomic — no partial file remains on disk", async () => {
    await addFavorite("zeta");
    const dir = path.join(tmpDir, "data");
    const files = await fs.readdir(dir);
    expect(files).toContain("favorites.json");
    expect(files).not.toContain("favorites.json.tmp");
  });
});
