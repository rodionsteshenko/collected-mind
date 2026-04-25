import { query } from "@anthropic-ai/claude-agent-sdk";

import { corpus } from "@/lib/advisor/corpus";
import { buildMcpServer, TOOL_NAMES } from "@/lib/advisor/tools";
import { SYSTEM } from "@/lib/advisor/prompt";
import { appendLog } from "@/lib/advisor/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_MODEL = process.env.ADVISOR_MODEL ?? "claude-sonnet-4-6";
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-haiku-4-5"]);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { situation?: string; model?: string };
  const situation = (body.situation ?? "").trim();
  if (!situation) {
    return new Response(JSON.stringify({ error: "situation is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const model =
    body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;

  await corpus.load();

  const reqId = Math.random().toString(36).slice(2, 8);
  const startedAt = Date.now();
  const log = (...args: unknown[]) =>
    console.log(`[${new Date().toISOString()}] [${reqId}]`, ...args);
  log(`POST /api/advise model=${model} len=${situation.length}`);
  log(
    `situation: ${situation.slice(0, 160).replace(/\s+/g, " ")}${situation.length > 160 ? "…" : ""}`,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const toolCounts: Record<string, number> = {};
      const mcpServer = buildMcpServer((ev) => {
        toolCounts[ev.tool] = (toolCounts[ev.tool] ?? 0) + 1;
        const argSummary =
          ev.tool === "search_semantic" || ev.tool === "search_text"
            ? `"${(ev.args as { query?: string }).query}"`
            : ev.tool === "get_concept"
              ? (ev.args as { slug?: string }).slug
              : JSON.stringify(ev.args);
        log(`tool ${ev.tool} ${argSummary} → ${ev.resultSummary}`);
        send("tool", ev);
      });

      const prompt = `Situation from the user:\n\n${situation}`;
      let finalText = "";
      let errored = false;

      try {
        for await (const msg of query({
          prompt,
          options: {
            model,
            systemPrompt: SYSTEM,
            mcpServers: { corpus: mcpServer },
            allowedTools: TOOL_NAMES,
            permissionMode: "bypassPermissions",
          },
        })) {
          if (msg.type === "assistant") {
            const content = (msg as any).message?.content ?? [];
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                finalText = block.text;
                const preview = block.text.slice(0, 140).replace(/\s+/g, " ");
                log(
                  `assistant_text (${block.text.length}c): ${preview}${block.text.length > 140 ? "…" : ""}`,
                );
                send("assistant_text", { text: block.text });
              } else if (block.type === "tool_use") {
                log(`assistant → tool_use ${block.name}`);
              }
            }
          } else if (msg.type === "result") {
            const m = msg as any;
            if (m.subtype === "success" && typeof m.result === "string") {
              finalText = m.result;
            }
            log(
              `result subtype=${m.subtype} duration=${m.duration_ms ?? "?"}ms num_turns=${m.num_turns ?? "?"}`,
            );
          }
        }

        const parsed = parseFinal(finalText);
        if (!parsed) {
          log(`PARSE FAIL — final text (${finalText.length}c): ${finalText.slice(0, 400)}`);
          send("error", {
            message: "Agent did not return expected <framing>/<picks> format.",
            raw: finalText,
          });
          errored = true;
        } else {
          const picks = parsed.picks
            .map((p) => {
              const c = corpus.bySlug.get(p.slug);
              if (!c) return null;
              return {
                slug: c.slug,
                title: c.title,
                oneLiner: c.oneLiner,
                domain: c.domain,
                form: c.form,
                obscurity: c.obscurity,
                why: p.why,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x != null);
          const saved = await appendLog({
            situation,
            model,
            framing: parsed.framing,
            picks,
          });
          log(`OK picks=${picks.length} [${picks.map((p) => p.slug).join(", ")}]`);
          send("result", {
            id: saved.id,
            ts: saved.ts,
            model,
            framing: parsed.framing,
            picks,
          });
        }
      } catch (err) {
        errored = true;
        log(`ERROR ${String((err as Error)?.stack ?? err)}`);
        send("error", { message: String((err as Error)?.message ?? err) });
      }

      log(
        `done ok=${!errored} elapsed=${Date.now() - startedAt}ms tools=${JSON.stringify(toolCounts)}`,
      );
      send("done", { ok: !errored });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function parseFinal(
  text: string,
): { framing: string; picks: { slug: string; why: string }[] } | null {
  const f = text.match(/<framing>([\s\S]*?)<\/framing>/);
  const p = text.match(/<picks>([\s\S]*?)<\/picks>/);
  if (!f || !p) return null;
  try {
    const picks = JSON.parse(p[1].trim()) as { slug: string; why: string }[];
    if (!Array.isArray(picks)) return null;
    return { framing: f[1].trim(), picks };
  } catch {
    return null;
  }
}
