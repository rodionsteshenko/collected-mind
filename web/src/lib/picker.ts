"use client";

import type { Concept } from "./types";
import { allSignals } from "./signals";

/** Deterministic daily RNG seeded by the local date. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function todaySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Frontier = not-yet-seen concepts, light bias toward higher surprise. */
export function pickDaily(concepts: Concept[], count = 4): Concept[] {
  const sigs = allSignals();
  const seen = new Set(Object.keys(sigs));
  const frontier = concepts.filter((c) => !seen.has(c.slug));
  const pool = frontier.length ? frontier : concepts;

  const rnd = mulberry32(todaySeed());
  // Score = surprise (0-10) + small random jitter; pick top N by scored sample.
  const scored = pool.map((c) => ({ c, s: c.surprise + rnd() * 6 }));
  scored.sort((a, b) => b.s - a.s);
  // Diversify: ensure at most 2 picks share the same dominant domain.
  const picks: Concept[] = [];
  const domainCount = new Map<string, number>();
  for (const { c } of scored) {
    const d = c.domain[0] ?? "_";
    if ((domainCount.get(d) ?? 0) >= 2) continue;
    picks.push(c);
    domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
    if (picks.length >= count) break;
  }
  return picks;
}
