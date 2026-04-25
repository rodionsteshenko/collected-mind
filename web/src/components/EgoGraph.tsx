"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import type { EgoLink, EgoNode } from "@/lib/egoGraph";

const FORM_COLOR: Record<string, string> = {
  effect: "#6366f1",
  paradox: "#f59e0b",
  phenomenon: "#10b981",
  fallacy: "#ef4444",
  bias: "#ec4899",
  thought_experiment: "#8b5cf6",
  concept: "#64748b",
  principle: "#14b8a6",
  heuristic: "#d97706",
};

type SimNode = EgoNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { w: number };

export function EgoGraph({
  nodes,
  links,
  width = 720,
  height = 460,
}: {
  nodes: EgoNode[];
  links: EgoLink[];
  width?: number;
  height?: number;
}) {
  const router = useRouter();
  const [, forceRender] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

  const graph = useMemo(() => {
    const ns: SimNode[] = nodes.map((n, i) => ({
      ...n,
      x: Math.cos((i / nodes.length) * Math.PI * 2) * 120,
      y: Math.sin((i / nodes.length) * Math.PI * 2) * 120,
      fx: n.isCenter ? 0 : null,
      fy: n.isCenter ? 0 : null,
    }));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const ls: SimLink[] = links
      .map((l) => {
        const s = byId.get(l.source);
        const t = byId.get(l.target);
        if (!s || !t) return null;
        return { source: s, target: t, w: l.w } as SimLink;
      })
      .filter((l): l is SimLink => l != null);
    return { ns, ls };
  }, [nodes, links]);

  useEffect(() => {
    const sim = forceSimulation<SimNode, SimLink>(graph.ns)
      .force(
        "link",
        forceLink<SimNode, SimLink>(graph.ls)
          .id((d) => d.id)
          .distance((d) => 70 + (1 - d.w) * 60)
          .strength((d) => 0.4 + d.w * 0.4),
      )
      .force("charge", forceManyBody().strength(-260))
      .force("collide", forceCollide(34))
      .alpha(1)
      .alphaDecay(0.04);
    sim.on("tick", () => forceRender((n) => n + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [graph]);

  const viewBox = `${-width / 2} ${-height / 2} ${width} ${height}`;
  const neighborIds = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const l of graph.ls) {
      const s = (l.source as SimNode).id;
      const t = (l.target as SimNode).id;
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [graph.ls]);

  const isLit = (id: number) => hover != null && (id === hover || neighborIds.get(hover)?.has(id));

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/50">
      <svg viewBox={viewBox} className="block h-[460px] w-full">
        <g>
          {graph.ls.map((l, i) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            const lit = hover != null && (s.id === hover || t.id === hover);
            const dim = hover != null && !lit;
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={lit ? "#3f3f46" : "#a1a1aa"}
                strokeOpacity={dim ? 0.08 : lit ? 0.6 : 0.25}
                strokeWidth={lit ? 1.4 : 0.8}
              />
            );
          })}
        </g>
        <g>
          {graph.ns.map((n) => {
            const color = FORM_COLOR[n.form] ?? "#64748b";
            const lit = hover == null || isLit(n.id);
            const r = n.isCenter ? 9 : 6;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (!n.isCenter) router.push(`/c/${n.slug}/`);
                }}
                style={{ cursor: n.isCenter ? "default" : "pointer" }}
                opacity={lit ? 1 : 0.25}
              >
                <circle
                  r={r}
                  fill={color}
                  stroke={n.isCenter ? "#0f172a" : "#fff"}
                  strokeWidth={n.isCenter ? 2 : 1.5}
                />
                <text
                  x={0}
                  y={-(r + 6)}
                  textAnchor="middle"
                  fontSize={n.isCenter ? 12 : 10}
                  fontWeight={n.isCenter ? 600 : 500}
                  className="fill-zinc-800 dark:fill-zinc-200"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {truncate(n.title, 28)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <FormLegend forms={Array.from(new Set(nodes.map((n) => n.form)))} />
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function FormLegend({ forms }: { forms: string[] }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
      {forms.map((f) => (
        <span key={f} className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: FORM_COLOR[f] ?? "#64748b" }}
          />
          {f.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}
