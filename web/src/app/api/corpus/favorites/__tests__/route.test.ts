import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/corpus/favorites/route";
import {
  DELETE,
  GET as GET_SLUG,
} from "@/app/api/corpus/favorites/[slug]/route";
import {
  buildEdges,
  makeConcept,
  seedCorpus,
  tinyCorpus,
} from "@/lib/corpus/__tests__/test-helpers";
import { _resetForTests } from "@/lib/favorites/store";

let tmpDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "favorites-route-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterAll(async () => {
  cwdSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await _resetForTests([]);
  const tiny = tinyCorpus();
  seedCorpus({
    concepts: tiny.concepts,
    embeddings: tiny.embeddings,
    edges: buildEdges([]),
  });
});

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("favorites REST", () => {
  it("POST adds a favorite for a known slug", async () => {
    const req = new Request("http://localhost/api/corpus/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "alpha" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.favorite.slug).toBe("alpha");
  });

  it("POST 404s when the slug is not in the corpus", async () => {
    const req = new Request("http://localhost/api/corpus/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "no-such-slug" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("POST 400s on missing slug", async () => {
    const req = new Request("http://localhost/api/corpus/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("GET returns favorites + similar centroid neighbors", async () => {
    // Favorite alpha (vec=[1,0]) and alpha-prime (close to it). The
    // centroid will be near them, so beta-prime + beta should rank
    // among "similar" before anti-alpha.
    await POST(
      new Request("http://localhost/api/corpus/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "alpha" }),
      }),
    );
    await POST(
      new Request("http://localhost/api/corpus/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "alpha-prime" }),
      }),
    );

    const res = await GET(new Request("http://localhost/api/corpus/favorites?k=3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.favorites.map((f: { slug: string }) => f.slug).sort()).toEqual([
      "alpha",
      "alpha-prime",
    ]);
    expect(Array.isArray(body.similar)).toBe(true);
    // Triangulate excludes the seeds themselves.
    expect(
      body.similar.every((s: { slug: string }) => s.slug !== "alpha" && s.slug !== "alpha-prime"),
    ).toBe(true);
  });

  it("GET returns empty similar when there are no favorites", async () => {
    const res = await GET(new Request("http://localhost/api/corpus/favorites"));
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.favorites).toEqual([]);
    expect(body.similar).toEqual([]);
  });

  it("GET /[slug] reports current favorite state", async () => {
    let res = await GET_SLUG(new Request("http://localhost/x"), ctx("alpha"));
    let body = await res.json();
    expect(body.isFavorite).toBe(false);

    await POST(
      new Request("http://localhost/api/corpus/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "alpha" }),
      }),
    );

    res = await GET_SLUG(new Request("http://localhost/x"), ctx("alpha"));
    body = await res.json();
    expect(body.isFavorite).toBe(true);
  });

  it("DELETE /[slug] removes the favorite", async () => {
    await POST(
      new Request("http://localhost/api/corpus/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "beta" }),
      }),
    );
    const res = await DELETE(new Request("http://localhost/x"), ctx("beta"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);

    const check = await GET_SLUG(new Request("http://localhost/x"), ctx("beta"));
    expect((await check.json()).isFavorite).toBe(false);
  });

  it("DELETE 404s on unknown slug", async () => {
    seedCorpus({ concepts: [makeConcept({ id: 99, slug: "only", title: "Only" })] });
    const res = await DELETE(new Request("http://localhost/x"), ctx("not-a-thing"));
    expect(res.status).toBe(404);
  });
});
