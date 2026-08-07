/** @jsxImportSource @zerotal/flow */
// ── <Chart> ─────────────────────────────────────────────────────────────────
//
// Line, area, bar and donut charts, drawn as SVG on the server.
//
// The split of work is deliberate: **geometry on the server, interaction on the
// client.**
//
// The paths and bars are computed once and shipped as markup, so a chart is in
// the HTML on first paint with no library to download and no layout shift — and
// it inherits the theme, because the colours are CSS variables the stylesheet
// already defines, including in dark mode where a canvas chart with baked-in
// colours gives itself away.
//
// Everything that answers to a pointer is Alpine: the crosshair and tooltip
// follow the cursor at frame rate, and the series draw themselves in on mount.
// Those need to respond within a frame, so they never involve the server; the
// browser is only re-reading numbers the markup already carries, not recomputing
// the chart.
//
// What is still out of scope: zooming and panning. For a dashboard that reports
// numbers this is the right trade; for an exploratory analytics tool, reach for
// a charting library.
//
//   <Chart type="line" labels={days} datasets={[{ label: "Orders", data: counts }]} />
//   <Chart type="donut" labels={["Paid","Pending"]} datasets={[{ data: [82, 18] }]} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export type ChartType = "line" | "area" | "bar" | "donut";

export interface ChartDataset {
  label?: string;
  data: number[];
  /** CSS colour. Defaults to the theme's series palette. */
  color?: string;
}

export interface ChartProps {
  type?: ChartType;
  labels: string[];
  datasets: ChartDataset[];
  /** Drawing height in pixels. Width is fluid. */
  height?: number;
  /** Draw the horizontal grid and the value axis. */
  grid?: boolean;
  /** Show a legend when there is more than one series. */
  legend?: boolean;
  /** Format a value for the axis and the accessible summary. */
  format?: ((value: number) => string) | undefined;
  class?: string;
  [key: string]: unknown;
}

/**
 * The default series colours.
 *
 * Theme variables, so a chart follows a re-theme without being told. `--primary`
 * leads because a single-series chart should be the panel's own colour.
 */
const PALETTE = [
  "var(--primary)",
  "var(--flow-toast-success, #16a34a)",
  "var(--flow-toast-warning, #d97706)",
  "var(--destructive)",
  "var(--muted-foreground)",
];

/** A rounded "nice" upper bound, so the axis reads 0–50 rather than 0–47. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/** An SVG path through the points of a series. */
function linePath(data: number[], max: number, width: number, height: number): string {
  if (data.length === 0) return "";
  const step = data.length === 1 ? 0 : width / (data.length - 1);
  return data
    .map((value, i) => {
      const x = i * step;
      const y = height - (value / max) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Polar coordinates for a donut arc. */
function arc(cx: number, cy: number, r: number, from: number, to: number, inner: number): string {
  const p = (angle: number, radius: number): [number, number] => [
    cx + radius * Math.cos(angle - Math.PI / 2),
    cy + radius * Math.sin(angle - Math.PI / 2),
  ];
  const [x1, y1] = p(from, r);
  const [x2, y2] = p(to, r);
  const [x3, y3] = p(to, inner);
  const [x4, y4] = p(from, inner);
  // A slice larger than half the circle needs the large-arc flag, or SVG draws
  // the short way round and the chart silently loses the majority segment.
  const large = to - from > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z`;
}

export function Chart(props: ChartProps): HtmlNode {
  const {
    type = "line",
    labels,
    datasets,
    height = 220,
    grid = true,
    legend,
    format,
    class: cls,
    ...rest
  } = props;

  const colourOf = (i: number, set: ChartDataset): string =>
    set.color ?? PALETTE[i % PALETTE.length]!;
  const fmt = (n: number): string => (format ? format(n) : String(n));

  // The accessible fallback. A chart is an image to a screen reader unless it is
  // given words, so the series are summarised rather than left as a blank frame.
  const summary = datasets
    .map((set) => `${set.label ?? "Series"}: ${set.data.map(fmt).join(", ")}`)
    .join(". ");

  if (type === "donut") {
    const values = datasets[0]?.data ?? [];
    const total = values.reduce((a, b) => a + b, 0);
    const size = height;
    const r = size / 2 - 2;
    const inner = r * 0.62;
    let angle = 0;

    return (
      <figure class={cn("flex items-center gap-6", cls)} {...rest}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={summary}
        >
          {total === 0 ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={(r + inner) / 2}
              fill="none"
              stroke="var(--muted)"
              stroke-width={r - inner}
            />
          ) : (
            values.map((value, i) => {
              const sweep = (value / total) * Math.PI * 2;
              const path = arc(size / 2, size / 2, r, angle, angle + sweep, inner);
              angle += sweep;
              return <path d={path} fill={colourOf(i, datasets[0]!)} />;
            })
          )}
        </svg>
        <figcaption class="space-y-1.5 text-sm">
          {labels.map((label, i) => (
            <span class="flex items-center gap-2">
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={`background:${colourOf(i, datasets[0]!)}`}
              />
              <span class="text-muted-foreground">{label}</span>
              <span class="ml-auto font-medium tabular-nums">{fmt(values[i] ?? 0)}</span>
            </span>
          ))}
        </figcaption>
      </figure>
    );
  }

  // A fixed viewBox with a fluid width: the SVG scales to its container, so the
  // chart is responsive without measuring anything.
  const W = 600;
  const H = height;
  const padLeft = grid ? 44 : 0;
  const padBottom = labels.length > 0 ? 22 : 0;
  const plotW = W - padLeft;
  const plotH = H - padBottom;

  const max = niceMax(Math.max(1, ...datasets.flatMap((d) => d.data)));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  // What the tooltip shows per x-position. Serialised once so the client reads
  // values rather than recomputing the chart.
  const points = labels.map((label, i) => ({
    x:
      (padLeft +
        (type === "bar"
          ? (i + 0.5) * (plotW / Math.max(labels.length, 1))
          : i * (plotW / Math.max(labels.length - 1, 1)))) /
      W,
    label,
    values: datasets.map((set, si) => ({
      label: set.label ?? `Series ${si + 1}`,
      value: fmt(set.data[i] ?? 0),
      color: colourOf(si, set),
    })),
  }));

  return (
    <figure
      class={cn("relative w-full", cls)}
      x-data={`flowChart(${JSON.stringify({ points })})`}
      {...{ "x-on:pointermove": "onMove($event)" }}
      {...{ "x-on:pointerleave": "onLeave()" }}
      {...rest}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
        class="overflow-visible"
      >
        {grid
          ? ticks.map((t) => {
              const y = plotH - t * plotH;
              return (
                <>
                  <line x1={padLeft} y1={y} x2={W} y2={y} stroke="var(--border)" stroke-width="1" />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    text-anchor="end"
                    font-size="11"
                    fill="var(--muted-foreground)"
                  >
                    {fmt(Math.round(max * t))}
                  </text>
                </>
              );
            })
          : null}

        <g transform={`translate(${padLeft},0)`}>
          {type === "bar"
            ? datasets.map((set, si) => {
                const groups = set.data.length || 1;
                const slot = plotW / groups;
                const barW = (slot * 0.7) / datasets.length;
                return set.data.map((value, i) => {
                  const h = (value / max) * plotH;
                  const x = i * slot + slot * 0.15 + si * barW;
                  return (
                    <rect
                      x={x}
                      y={plotH - h}
                      width={barW}
                      height={Math.max(h, value > 0 ? 1 : 0)}
                      rx="2"
                      fill={colourOf(si, set)}
                    />
                  );
                });
              })
            : datasets.map((set, si) => {
                const d = linePath(set.data, max, plotW, plotH);
                const colour = colourOf(si, set);
                return (
                  <>
                    {type === "area" && d ? (
                      <path
                        d={`${d} L${plotW},${plotH} L0,${plotH} Z`}
                        fill={colour}
                        opacity="0.12"
                      />
                    ) : null}
                    <path
                      d={d}
                      fill="none"
                      stroke={colour}
                      stroke-width="2"
                      stroke-linejoin="round"
                      stroke-linecap="round"
                      // The viewBox is stretched horizontally, which would
                      // stretch the stroke with it; this keeps it even.
                      vector-effect="non-scaling-stroke"
                      // Drawn in on mount by animating the dash offset. Starts
                      // fully drawn in the markup, so a client without
                      // JavaScript sees the finished chart rather than nothing.
                      {...{
                        "x-bind:style":
                          "`stroke-dasharray:2000;stroke-dashoffset:${ready ? 0 : 2000};transition:stroke-dashoffset .7s ease-out`",
                      }}
                    />
                  </>
                );
              })}
        </g>

        {labels.length > 0
          ? labels.map((label, i) => {
              const slot =
                plotW / (type === "bar" ? labels.length : Math.max(labels.length - 1, 1));
              const x = padLeft + (type === "bar" ? i * slot + slot / 2 : i * slot);
              // Every label on a dense axis becomes unreadable overlap, so only
              // as many as comfortably fit are drawn.
              const stride = Math.ceil(labels.length / 8);
              if (i % stride !== 0 && i !== labels.length - 1) return null;
              return (
                <text
                  x={x}
                  y={H - 6}
                  text-anchor="middle"
                  font-size="11"
                  fill="var(--muted-foreground)"
                >
                  {label}
                </text>
              );
            })
          : null}
      </svg>

      {/* Crosshair + tooltip. Positioned from the pointer, so they keep up with
          it; the numbers come from the serialised points rather than a second
          computation of the chart. */}
      <div
        x-show="hover >= 0"
        x-cloak
        class="pointer-events-none absolute inset-y-0 w-px bg-border"
        {...{ "x-bind:style": "`left:${tipX}px`" }}
      />
      <div
        x-show="hover >= 0"
        x-cloak
        {...{ "x-transition.opacity": true }}
        class="pointer-events-none absolute top-2 z-10 min-w-32 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md"
        {...{ "x-bind:style": "`left:${tipX}px`" }}
      >
        <p class="mb-1 font-medium" {...{ "x-text": "tip()?.label" }} />
        <template {...{ "x-for": "row in (tip()?.values ?? [])", ":key": "row.label" }}>
          <span class="flex items-center gap-1.5">
            <span
              class="h-2 w-2 shrink-0 rounded-sm"
              {...{ "x-bind:style": "`background:${row.color}`" }}
            />
            <span class="text-muted-foreground" {...{ "x-text": "row.label" }} />
            <span class="ml-auto font-medium tabular-nums" {...{ "x-text": "row.value" }} />
          </span>
        </template>
      </div>

      {legend !== false && datasets.length > 1 ? (
        <figcaption class="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {datasets.map((set, i) => (
            <span class="inline-flex items-center gap-1.5">
              <span class="h-2 w-2 rounded-sm" style={`background:${colourOf(i, set)}`} />
              {set.label ?? `Series ${i + 1}`}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}
