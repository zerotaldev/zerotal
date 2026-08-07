/** @jsxImportSource @zerotal/flow */
import type { HtmlNode } from "@zerotal/flow";

/** Build a polyline points string normalised to a w×h box. */
export function sparkPoints(s: number[], w: number, h: number): string {
  if (s.length === 0) return "";
  const max = Math.max(...s);
  const min = Math.min(...s);
  const r = max - min || 1;
  return s
    .map(
      (v, i) => `${((i / (s.length - 1)) * w).toFixed(1)},${(h - ((v - min) / r) * h).toFixed(1)}`,
    )
    .join(" ");
}

/** Build line + filled-area paths for an area chart normalised to a w×h box. */
export function areaPaths(s: number[], w: number, h: number): { line: string; area: string } {
  if (s.length === 0) return { line: "", area: "" };
  const max = Math.max(...s) * 1.15 || 1;
  const pts = s.map((v, i) => [(i / (s.length - 1)) * w, h - (v / max) * h] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

interface SparklineProps {
  series: number[];
  w?: number;
  h?: number;
  stroke?: string;
  class?: string;
}

/** A compact sparkline SVG. */
export function Sparkline(props: SparklineProps): HtmlNode {
  const w = props.w ?? 120;
  const h = props.h ?? 30;
  return (
    <svg
      class={props.class ?? "w-full h-8"}
      viewBox={`0 0 ${w} ${h + 2}`}
      preserveAspectRatio="none"
    >
      <polyline
        points={sparkPoints(props.series, w, h)}
        fill="none"
        stroke={props.stroke ?? "hsl(var(--primary))"}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}
