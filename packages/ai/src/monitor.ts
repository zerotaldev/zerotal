/**
 * The AI section contributed to `@zerotal/monitor`.
 *
 * The panel is *described*, not rendered — the monitor owns the shell and this
 * package owns the knowledge of what is worth watching about a model call. The
 * host interface is declared locally so this package has no dependency on the
 * monitor at all: an app without it simply never resolves the binding.
 */
import type { Application } from "@zerotal/core";
import { modelStats, recentGenerations, refusalRate } from "./stats.ts";
import { spentToday } from "./spend.ts";
import type { AiConfigShape } from "./types.ts";

/** The monitor's write surface, redeclared to avoid a dependency. */
interface MonitorHost {
  enabled(id: string): boolean;
  section(section: {
    id: string;
    label: string;
    group?: string;
    icon?: string;
    sort?: number;
    resolve(range: string): unknown;
  }): void;
}

/** A chat bubble with a spark inside — generation, not messaging. */
const ICON =
  `<svg class="w-5 h-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M17 11.5a4 4 0 0 1-4 4H8l-4 3v-3H4a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" ` +
  `transform="translate(1.5 0.5)"/>` +
  `<path d="M10 5.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5L6.5 9 9 8z"/></svg>`;

/**
 * Register the AI section, if the monitor is installed and the app left it on.
 *
 * @internal
 */
export function installAiMonitor(app: Application, config: AiConfigShape): void {
  const monitor = app.container.tryMake("monitor.panel" as never) as MonitorHost | undefined;
  if (!monitor?.enabled("ai")) return;

  monitor.section({
    id: "ai",
    label: "AI",
    group: "Integrations",
    icon: ICON,
    resolve: () => resolveSection(config),
  });
}

/** The section's content. Reads only what the package already recorded. */
function resolveSection(config: AiConfigShape): unknown {
  const models = modelStats();
  const recent = recentGenerations(30);

  const calls = models.reduce((total, m) => total + m.calls, 0);
  const outputTokens = models.reduce((total, m) => total + m.outputTokens, 0);
  const inputTokens = models.reduce((total, m) => total + m.inputTokens, 0);
  const cacheReadTokens = models.reduce((total, m) => total + m.cacheReadTokens, 0);
  const refusals = refusalRate();
  const spent = spentToday();

  const stats = [
    { label: "Generations", value: calls, detail: `${models.length} model(s) in the buffer` },
    {
      label: "Spend today",
      value: `$${spent.toFixed(4)}`,
      detail:
        config.limits.perDayUsd > 0
          ? `of $${config.limits.perDayUsd.toFixed(2)} ceiling`
          : "estimated at list prices · no ceiling set",
      ...(config.limits.perDayUsd > 0
        ? { percent: Math.min(100, (spent / config.limits.perDayUsd) * 100) }
        : {}),
      tone: ceilingTone(spent, config.limits.perDayUsd),
    },
    {
      label: "Tokens",
      value: `${format(inputTokens)} in / ${format(outputTokens)} out`,
      detail:
        cacheReadTokens > 0
          ? `${format(cacheReadTokens)} served from cache`
          : "no cache reads recorded",
    },
    {
      label: "Refusal rate",
      value: `${(refusals * 100).toFixed(1)}%`,
      detail: "provider declined the request",
      tone: refusals > 0.05 ? "warn" : "default",
    },
  ];

  return {
    stats,
    tables: [
      {
        title: "By model",
        columns: [
          { key: "model", label: "Model", mono: true },
          { key: "calls", label: "Calls", align: "end" },
          {
            key: "inputTokens",
            label: "In",
            align: "end",
            format: (v: unknown) => format(Number(v)),
          },
          {
            key: "outputTokens",
            label: "Out",
            align: "end",
            format: (v: unknown) => format(Number(v)),
          },
          {
            key: "costUsd",
            label: "Cost",
            align: "end",
            format: (v: unknown) => (Number(v) > 0 ? `$${Number(v).toFixed(4)}` : "—"),
          },
          { key: "p50", label: "p50", align: "end", format: (v: unknown) => `${String(v)} ms` },
          { key: "p95", label: "p95", align: "end", format: (v: unknown) => `${String(v)} ms` },
          {
            key: "failures",
            label: "Failed",
            align: "end",
            tone: (v: unknown) => (Number(v) > 0 ? "bad" : null),
          },
          {
            key: "refusals",
            label: "Refused",
            align: "end",
            tone: (v: unknown) => (Number(v) > 0 ? "warn" : null),
          },
        ],
        rows: models,
        empty: "No generations recorded yet.",
      },
      {
        title: "Recent generations",
        columns: [
          { key: "operation", label: "Op" },
          { key: "model", label: "Model", mono: true },
          { key: "preview", label: "Prompt" },
          {
            key: "durationMs",
            label: "Time",
            align: "end",
            format: (v: unknown) => `${Math.round(Number(v))} ms`,
          },
          {
            key: "ok",
            label: "Result",
            format: (_v: unknown, row: Record<string, unknown>) =>
              row["refused"] ? "refused" : row["ok"] ? "ok" : "failed",
            tone: (_v: unknown, row: Record<string, unknown>) =>
              row["refused"] ? "warn" : row["ok"] ? "good" : "bad",
          },
        ],
        rows: recent,
        empty: "No generations recorded yet.",
      },
    ],
  };
}

function ceilingTone(spent: number, ceiling: number): "default" | "warn" | "bad" {
  if (ceiling <= 0) return "default";
  const share = spent / ceiling;
  if (share >= 1) return "bad";
  return share >= 0.8 ? "warn" : "default";
}

/** Thousands separators, but short: 12.3k rather than 12,345. */
function format(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
