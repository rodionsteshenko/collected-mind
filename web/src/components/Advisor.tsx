"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "./Badge";
import { label } from "@/lib/labels";

type Pick = {
  slug: string;
  title: string;
  oneLiner: string;
  domain: string[];
  form: string;
  obscurity: number;
  why: string;
};

type Result = { id?: string; ts?: number; model?: string; framing: string; picks: Pick[] };
type LogEntry = {
  id: string;
  ts: number;
  situation: string;
  model?: string;
  framing: string;
  picks: Pick[];
};

type ToolEvent = {
  tool: string;
  args: Record<string, unknown>;
  resultSummary: string;
};

const ADVISE_URL = "/api/advise";
const LOG_URL = "/api/log";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const;
type ModelId = (typeof MODELS)[number]["id"];
const DEFAULT_MODEL: ModelId = "claude-sonnet-4-6";
const MODEL_LABEL: Record<string, string> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.label]),
);
const MODEL_KEY = "collected-mind:advisor-model";

const TOOL_LABEL: Record<string, string> = {
  search_semantic: "Searched",
  search_text: "Keyword",
  get_concept: "Opened",
  filter_by_facet: "Filtered",
};

export function Advisor() {
  const [situation, setSituation] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const abortRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(LOG_URL);
      if (!r.ok) return;
      const j = (await r.json()) as { entries: LogEntry[] };
      setHistory(j.entries ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    loadHistory();
    try {
      const saved = localStorage.getItem(MODEL_KEY);
      if (saved && MODELS.some((m) => m.id === saved)) setModel(saved as ModelId);
    } catch {}
  }, [loadHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(MODEL_KEY, model);
    } catch {}
  }, [model]);

  const reset = () => {
    setEvents([]);
    setNotes([]);
    setResult(null);
    setError(null);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const submit = useCallback(async () => {
    const text = situation.trim();
    if (!text || busy) return;
    reset();
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const r = await fetch(ADVISE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ situation: text, model }),
        signal: controller.signal,
      });
      if (!r.ok || !r.body) {
        throw new Error(`advisor ${r.status}: ${await r.text().catch(() => "")}`);
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const chunk of parts) handleSSE(chunk);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(String((e as Error).message ?? e));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      loadHistory();
    }

    function handleSSE(chunk: string) {
      const lines = chunk.split("\n");
      let ev = "message";
      let data = "";
      for (const ln of lines) {
        if (ln.startsWith("event: ")) ev = ln.slice(7).trim();
        else if (ln.startsWith("data: ")) data += ln.slice(6);
      }
      if (!data) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (ev === "tool") setEvents((prev) => [...prev, parsed as ToolEvent]);
      else if (ev === "assistant_text") {
        const text = (parsed as { text: string }).text;
        if (text && !text.includes("<framing>")) {
          setNotes((prev) => [...prev, text.trim()]);
        }
      } else if (ev === "result") setResult(parsed as Result);
      else if (ev === "error") setError((parsed as { message: string }).message);
    }
  }, [situation, busy, model, loadHistory]);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900/50">
        <textarea
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          rows={5}
          placeholder="What's going on? e.g. My manager keeps telling me how to do my job even though I have more expertise…"
          className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-100/10"
          disabled={busy}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={busy || !situation.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {busy ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900" />
                Thinking…
              </>
            ) : (
              "Find concepts"
            )}
          </button>
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Stop
            </button>
          ) : null}

          <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 text-xs dark:border-zinc-700">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                disabled={busy}
                className={
                  m.id === model
                    ? "bg-zinc-900 px-3 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-white px-3 py-2 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }
              >
                {m.label}
              </button>
            ))}
          </div>

        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="font-medium">{error}</div>
        </div>
      ) : null}

      {(busy || events.length > 0) && !result ? (
        <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            <span>Research trace</span>
            {busy ? (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
            ) : null}
          </div>
          <ul className="flex flex-col gap-1.5 font-mono text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {events.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-zinc-400">{TOOL_LABEL[e.tool] ?? e.tool}</span>
                <span className="min-w-0 flex-1">
                  {e.tool === "search_semantic" || e.tool === "search_text" ? (
                    <>
                      <span className="text-zinc-900 dark:text-zinc-100">
                        &ldquo;{String((e.args as { query: string }).query)}&rdquo;
                      </span>
                      <span className="text-zinc-400"> → {e.resultSummary}</span>
                    </>
                  ) : e.tool === "get_concept" ? (
                    <>
                      <span className="text-zinc-900 dark:text-zinc-100">
                        {String((e.args as { slug: string }).slug)}
                      </span>
                      <span className="text-zinc-400"> ({e.resultSummary})</span>
                    </>
                  ) : (
                    <span className="text-zinc-400">
                      {JSON.stringify(e.args)} → {e.resultSummary}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {notes.length > 0 ? (
            <div className="mt-4 border-t border-zinc-200 pt-3 text-xs italic leading-relaxed text-zinc-500 dark:border-zinc-800">
              {notes[notes.length - 1]}
            </div>
          ) : null}
        </section>
      ) : null}

      {result ? <AdvisorResult framing={result.framing} picks={result.picks} /> : null}

      {history.length > 0 ? (
        <section className="flex flex-col gap-4 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              Past answers
            </h2>
            <span className="text-xs text-zinc-400">{history.length}</span>
          </div>
          <ul className="flex flex-col gap-2">
            {history.map((h) => {
              const open = openId === h.id;
              return (
                <li
                  key={h.id}
                  className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : h.id)}
                    className="flex w-full items-start gap-3 p-4 text-left transition hover:bg-zinc-50 sm:p-5 dark:hover:bg-zinc-900"
                  >
                    <span className="mt-1 text-xs text-zinc-400">{open ? "▾" : "▸"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                        {h.situation}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                        <time>{new Date(h.ts).toLocaleString()}</time>
                        <span>·</span>
                        <span>{h.picks.length} picks</span>
                        {h.model ? (
                          <>
                            <span>·</span>
                            <span>{MODEL_LABEL[h.model] ?? h.model}</span>
                          </>
                        ) : null}
                        <span className="min-w-0 truncate">
                          · {h.picks.slice(0, 3).map((p) => p.title).join(", ")}
                          {h.picks.length > 3 ? "…" : ""}
                        </span>
                      </div>
                    </div>
                  </button>
                  {open ? (
                    <div className="border-t border-zinc-200 bg-zinc-50/50 p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <AdvisorResult framing={h.framing} picks={h.picks} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function AdvisorResult({ framing, picks }: { framing: string; picks: Pick[] }) {
  return (
    <div className="flex flex-col gap-5">
      <blockquote className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 text-[15px] leading-relaxed text-zinc-800 sm:p-6 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-zinc-200">
        {framing}
      </blockquote>
      <ul className="flex flex-col gap-3">
        {picks.map((p) => (
          <li
            key={p.slug}
            className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
          >
            <div className="flex items-start justify-between gap-4">
              <Link
                href={`/c/${p.slug}/`}
                className="text-[17px] font-semibold tracking-tight text-zinc-900 hover:underline dark:text-zinc-100"
              >
                {p.title}
              </Link>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <Badge tone="violet">{label("form", p.form)}</Badge>
                {p.domain.slice(0, 1).map((d) => (
                  <Badge key={d} tone="indigo">
                    {label("domain", d)}
                  </Badge>
                ))}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {p.oneLiner}
            </p>
            <p className="text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
              <span className="mr-1 font-medium text-zinc-500 dark:text-zinc-400">
                Why this fits —
              </span>
              {p.why}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
