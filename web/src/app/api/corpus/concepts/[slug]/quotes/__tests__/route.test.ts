import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/corpus/concepts/[slug]/quotes/route";
import { makeConcept, seedCorpus } from "@/lib/corpus/__tests__/test-helpers";
import type { Quote } from "@/lib/types";

const sample: Quote[] = [
  {
    text: "We suffer more often in imagination than in reality.",
    attribution: "Seneca, Letters",
    source: "wikiquote",
    sourceUrl: "https://en.wikiquote.org/wiki/Seneca_the_Younger",
  },
  {
    text: "The unexamined life is not worth living.",
    attribution: "Socrates, Apology",
    source: "llm_verified",
    sourceUrl: "https://en.wikiquote.org/wiki/Socrates",
  },
];

beforeEach(() => {
  seedCorpus({
    concepts: [
      makeConcept({ id: 1, slug: "wisdom", title: "Wisdom" }),
      makeConcept({ id: 2, slug: "no-quotes", title: "Quoteless" }),
    ],
    quotes: { "1": sample },
  });
});

function makeCtx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("GET /api/corpus/concepts/[slug]/quotes", () => {
  it("returns quotes when the concept exists and has them", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("wisdom"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("wisdom");
    expect(body.title).toBe("Wisdom");
    expect(body.count).toBe(2);
    expect(body.quotes).toEqual(sample);
  });

  it("returns count=0 + empty array when the concept exists but has no quotes", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("no-quotes"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("no-quotes");
    expect(body.count).toBe(0);
    expect(body.quotes).toEqual([]);
  });

  it("returns 404 when the concept does not exist", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("missing-slug"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("missing-slug");
  });

  it("preserves attribution and source fields in the response", async () => {
    const res = await GET(new Request("http://localhost/x"), makeCtx("wisdom"));
    const body = await res.json();
    expect(body.quotes[0].source).toBe("wikiquote");
    expect(body.quotes[0].attribution).toBe("Seneca, Letters");
    expect(body.quotes[1].source).toBe("llm_verified");
    expect(body.quotes[1].sourceUrl).toContain("Socrates");
  });
});
