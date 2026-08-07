/**
 * Value → colour mappings shared across the panel.
 *
 * Everything here resolves to flow-ui design tokens rather than literal palette
 * classes, so the panel re-themes (and follows dark mode) wherever it is used.
 * Semantic states use `success` / `warning` / `destructive`; the span colours are
 * categorical and use the theme's chart palette instead — "middleware" isn't good
 * or bad, it just has to stay distinguishable from "query".
 */
import type { Tone } from "../store/types.ts";

export function toneText(tone: Tone | undefined): string {
  switch (tone) {
    case "ok":
      return "text-success";
    case "warn":
      return "text-warning";
    case "bad":
      return "text-destructive";
    default:
      return "text-foreground";
  }
}

export function methodTone(m: string): string {
  return (
    (
      {
        GET: "bg-primary/10 text-primary",
        POST: "bg-success/10 text-success",
        PUT: "bg-warning/10 text-warning",
        PATCH: "bg-warning/10 text-warning",
        DELETE: "bg-destructive/10 text-destructive",
      } as Record<string, string>
    )[m] ?? "bg-muted text-muted-foreground"
  );
}

export function statusTone(s: number): string {
  if (s < 300) return "text-success";
  if (s < 400) return "text-primary";
  if (s < 500) return "text-warning";
  return "text-destructive";
}

export function pctTone(ms: number): string {
  return ms > 500 ? "text-destructive" : ms > 200 ? "text-warning" : "text-foreground";
}

/**
 * Colour for a trace span, by kind.
 *
 * Returned as a raw CSS colour rather than a class because these are applied to
 * SVG `fill`/`stroke` and inline widths, which Tailwind utilities can't reach.
 */
export function spanColor(kind: string): string {
  return (
    (
      {
        boot: "hsl(var(--muted-foreground))",
        middleware: "hsl(var(--chart-5))",
        controller: "hsl(var(--chart-2))",
        query: "hsl(var(--chart-3))",
        cache: "hsl(var(--chart-4))",
        http: "hsl(var(--chart-6))",
        view: "hsl(var(--chart-7))",
      } as Record<string, string>
    )[kind] ?? "hsl(var(--muted-foreground))"
  );
}

export function gaugeBar(value: number): string {
  return value > 85 ? "bg-destructive" : value > 65 ? "bg-warning" : "bg-primary";
}

export function gaugeText(value: number): string {
  return value > 85 ? "text-destructive" : value > 65 ? "text-warning" : "text-foreground";
}
