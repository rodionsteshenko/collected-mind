import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/corpus/dismissed/route";
import {
  DELETE,
  GET as GET_SLUG,
} from "@/app/api/corpus/dismissed/[slug]/route";
import { buildEdges, seedCorpus, tinyCorpus } from "@/lib/corpus/__tests__/test-helpers";
import { _resetForTests } from "@/lib/dismissed/store";

let tmpDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dismissed-route-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterAll(async () => {
  cwdSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await _resetForTests([]);
  const tiny = tinyCorpus();
  seedCorpus({ concepts: tiny.concepts, embeddings: tiny.embeddings, edges: buildEdges([]) });
});

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("dismissed REST", () => {
  it("POST then GET round-trips", async () => {
    const post = await POST(
      new Request("http://localhost/api/corpus/dismissed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "alpha" }),
      }),
    );
    expect(post.status).toBe(201);

    const list = await GET();
    const body = await list.json();
    expect(body.count).toBe(1);
    expect(body.dismissed[0].slug).toBe("alpha");
    expect(body.dismissed[0].dismissedAt).toBeTruthy();
  });

  it("GET /[slug] reports state and DELETE removes", async () => {
    await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "beta" }),
      }),
    );
    let r = await GET_SLUG(new Request("http://localhost/x"), ctx("beta"));
    expect((await r.json()).isDismissed).toBe(true);

    const del = await DELETE(new Request("http://localhost/x"), ctx("beta"));
    expect(del.status).toBe(200);

    r = await GET_SLUG(new Request("http://localhost/x"), ctx("beta"));
    expect((await r.json()).isDismissed).toBe(false);
  });

  it("POST 404s for unknown slug", async () => {
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "ghost" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
