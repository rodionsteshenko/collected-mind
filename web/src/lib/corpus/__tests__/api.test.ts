import { describe, expect, it } from "vitest";

import {
  applyFilters,
  clampInt,
  errorResponse,
  jsonResponse,
  optionsResponse,
  parseFilters,
  parseSort,
  slim,
  sortBy,
} from "@/lib/corpus/api";

import { makeConcept } from "./test-helpers";

describe("slim", () => {
  it("projects only public-facing fields", () => {
    const c = makeConcept({
      id: 1,
      slug: "x",
      title: "X",
      aha: "secret aha",
      example: "secret example",
    });
    const s = slim(c);
    expect(s).toEqual({
      id: 1,
      slug: "x",
      title: "X",
      oneLiner: c.oneLiner,
      domain: c.domain,
      form: c.form,
      affect: c.affect,
      obscurity: c.obscurity,
      surprise: c.surprise,
    });
    expect(s).not.toHaveProperty("aha");
    expect(s).not.toHaveProperty("example");
    expect(s).not.toHaveProperty("wikiUrl");
  });
});

describe("parseFilters", () => {
  it("returns undefined for empty/missing fields, numbers for numeric ones", () => {
    const sp = new URLSearchParams("form=concept&domain=&minObscurity=2&maxSurprise=8&junk=ignore");
    expect(parseFilters(sp)).toEqual({
      form: "concept",
      domain: undefined,
      affect: undefined,
      source: undefined,
      minObscurity: 2,
      maxObscurity: undefined,
      minSurprise: undefined,
      maxSurprise: 8,
    });
  });

  it("returns undefined for non-numeric values in numeric fields", () => {
    const sp = new URLSearchParams("minObscurity=abc&maxObscurity=4");
    const f = parseFilters(sp);
    expect(f.minObscurity).toBeUndefined();
    expect(f.maxObscurity).toBe(4);
  });
});

describe("applyFilters", () => {
  const concepts = [
    makeConcept({ id: 1, slug: "a", title: "A", domain: ["philosophy", "psychology"], form: "concept", affect: ["calm"], obscurity: 2, surprise: 7, source: "wiki" }),
    makeConcept({ id: 2, slug: "b", title: "B", domain: ["biology"], form: "phenomenon", affect: ["awe"], obscurity: 5, surprise: 3, source: "wiki" }),
    makeConcept({ id: 3, slug: "c", title: "C", domain: ["philosophy"], form: "principle", affect: ["calm", "awe"], obscurity: 4, surprise: 9, source: "manual" }),
  ];

  it("filters by single facets", () => {
    expect(applyFilters(concepts, { form: "concept" }).map((c) => c.id)).toEqual([1]);
    expect(applyFilters(concepts, { domain: "philosophy" }).map((c) => c.id)).toEqual([1, 3]);
    expect(applyFilters(concepts, { affect: "awe" }).map((c) => c.id)).toEqual([2, 3]);
    expect(applyFilters(concepts, { source: "manual" }).map((c) => c.id)).toEqual([3]);
  });

  it("combines facets with AND", () => {
    expect(
      applyFilters(concepts, { domain: "philosophy", affect: "calm" }).map((c) => c.id),
    ).toEqual([1, 3]);
  });

  it("filters by obscurity/surprise ranges (inclusive)", () => {
    expect(applyFilters(concepts, { minObscurity: 4 }).map((c) => c.id)).toEqual([2, 3]);
    expect(applyFilters(concepts, { maxObscurity: 4 }).map((c) => c.id)).toEqual([1, 3]);
    expect(applyFilters(concepts, { minSurprise: 7, maxSurprise: 9 }).map((c) => c.id)).toEqual([1, 3]);
  });

  it("returns the full list when filters are all undefined", () => {
    expect(applyFilters(concepts, {}).length).toBe(3);
  });
});

describe("parseSort", () => {
  it("defaults to surprise", () => {
    expect(parseSort(new URLSearchParams())).toBe("surprise");
    expect(parseSort(new URLSearchParams("sort=garbage"))).toBe("surprise");
  });
  it("recognizes obscurity and title", () => {
    expect(parseSort(new URLSearchParams("sort=obscurity"))).toBe("obscurity");
    expect(parseSort(new URLSearchParams("sort=title"))).toBe("title");
  });
});

describe("sortBy", () => {
  const concepts = [
    makeConcept({ id: 1, slug: "b", title: "Banana", obscurity: 3, surprise: 5 }),
    makeConcept({ id: 2, slug: "a", title: "Apple", obscurity: 1, surprise: 9 }),
    makeConcept({ id: 3, slug: "c", title: "Cherry", obscurity: 5, surprise: 1 }),
  ];

  it("sorts by surprise descending", () => {
    expect(sortBy(concepts, "surprise").map((c) => c.id)).toEqual([2, 1, 3]);
  });
  it("sorts by obscurity ascending (most accessible first)", () => {
    expect(sortBy(concepts, "obscurity").map((c) => c.id)).toEqual([2, 1, 3]);
  });
  it("sorts by title ascending", () => {
    expect(sortBy(concepts, "title").map((c) => c.id)).toEqual([2, 1, 3]);
  });
  it("does not mutate input", () => {
    const before = concepts.map((c) => c.id);
    sortBy(concepts, "surprise");
    expect(concepts.map((c) => c.id)).toEqual(before);
  });
});

describe("clampInt", () => {
  it("uses default for null/empty/non-numeric", () => {
    expect(clampInt(null, 10, 1, 100)).toBe(10);
    expect(clampInt("", 10, 1, 100)).toBe(10);
    expect(clampInt("abc", 10, 1, 100)).toBe(10);
  });
  it("clamps to bounds", () => {
    expect(clampInt("-5", 10, 1, 100)).toBe(1);
    expect(clampInt("250", 10, 1, 100)).toBe(100);
    expect(clampInt("42", 10, 1, 100)).toBe(42);
  });
  it("floors fractional input", () => {
    expect(clampInt("7.9", 10, 1, 100)).toBe(7);
  });
});

describe("HTTP responses", () => {
  it("jsonResponse returns 200 with CORS + JSON content-type", async () => {
    const res = jsonResponse({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toMatch(/max-age/);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("errorResponse defaults to 400 and serializes the message", async () => {
    const res = errorResponse("nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("errorResponse honors explicit status", async () => {
    const res = errorResponse("missing", 404);
    expect(res.status).toBe(404);
  });

  it("optionsResponse returns 204 with CORS only", () => {
    const res = optionsResponse();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
