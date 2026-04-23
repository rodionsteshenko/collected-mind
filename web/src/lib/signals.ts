"use client";

import type { Signal } from "./types";

const KEY = "collected-mind:signals:v1";

type Store = Record<string, { signal: Signal; at: number }>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(s: Store) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("cm:signals"));
}

export function getSignal(slug: string): Signal | null {
  return read()[slug]?.signal ?? null;
}

export function setSignal(slug: string, signal: Signal | null) {
  const s = read();
  if (signal === null) {
    delete s[slug];
  } else {
    s[slug] = { signal, at: Date.now() };
  }
  write(s);
}

export function allSignals(): Store {
  return read();
}

export function subscribe(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => fn();
  window.addEventListener("cm:signals", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("cm:signals", handler);
    window.removeEventListener("storage", handler);
  };
}

export function exportJson(): string {
  return JSON.stringify(read(), null, 2);
}

export function importJson(data: string): number {
  try {
    const parsed = JSON.parse(data) as Store;
    write(parsed);
    return Object.keys(parsed).length;
  } catch {
    return -1;
  }
}

export function countsByDay(): { date: string; count: number }[] {
  const s = read();
  const byDay = new Map<string, number>();
  for (const { at } of Object.values(s)) {
    const d = new Date(at);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ date, count }));
}
