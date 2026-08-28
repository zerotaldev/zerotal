/** @jsxImportSource @zerotal/flow */
// Widget rendering, shared by the dashboard and by resource pages.
//
// Widgets are data providers — they resolve values and leave the markup to the
// panel. Keeping that markup in one place is what lets the same widget appear on
// the dashboard and above a resource's table without being written twice.

import type { HtmlNode } from "@zerotal/flow";
import { Table } from "@zerotal/flow-ui";
import { Icon } from "../ui/icons.tsx";
import { StatsWidget, ChartWidget, TableWidget } from "./Widget.ts";
import type { DashboardWidget, WidgetTone } from "./Widget.ts";

const STAT_TONE: Record<WidgetTone, string> = {
  default: "bg-secondary text-secondary-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

const STAT_COLS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * Build the inline Chart.js init script (injected raw via dangerouslySetInnerHTML
 * so its `<`/`>` operators aren't HTML-escaped). Loads Chart.js from the CDN on
 * demand, then draws each canvas once.
 *
 * `idPrefix` keeps canvases unique when two widget sets share a page — a
 * resource's own widgets above its table, say, alongside a contributed one.
 */
export function chartInitScript(configs: unknown[]): string {
  if (!Array.isArray(configs) || configs.length === 0) return "";
  const data = JSON.stringify(configs);
  return `(function(){var C=${data};function pal(n){var o=[];for(var i=0;i<n;i++){o.push('hsl('+((i*53)%360)+' 70% 55%)');}return o;}function draw(){var r=getComputedStyle(document.documentElement);var p='hsl('+r.getPropertyValue('--primary').trim()+')';C.forEach(function(c){var el=document.getElementById(c.id);if(!el||el.__k){return;}el.__k=1;var pie=(c.type==='doughnut'||c.type==='pie');var line=(c.type==='line');new Chart(el,{type:c.type,data:{labels:c.labels,datasets:c.datasets.map(function(d){var col=d.color||p;return{label:d.label,data:d.data,backgroundColor:pie?pal(c.labels.length):(line?col+'33':col),borderColor:pie?'transparent':col,borderWidth:2,tension:0.35,fill:line};})},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:(c.datasets.length>1)||pie}},scales:pie?{}:{y:{beginAtZero:true}}}});});}if(window.Chart){draw();}else{var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';s.onload=draw;document.head.appendChild(s);}})();`;
}

/**
 * Resolve and render a set of widgets.
 *
 * Returns `null` when there is nothing to draw, so a caller can drop the whole
 * block rather than leaving an empty gap above its table.
 *
 * @internal
 */
export async function renderWidgets(
  widgets: DashboardWidget[],
  idPrefix = "kchart",
): Promise<HtmlNode | null> {
  if (widgets.length === 0) return null;

  const statGroups = await Promise.all(
    widgets
      .filter((w): w is StatsWidget => w instanceof StatsWidget)
      .map(async (w) => ({ columns: w._columns, stats: await w.stats() })),
  );

  const charts = await Promise.all(
    widgets
      .filter((w): w is ChartWidget => w instanceof ChartWidget)
      .map(async (w, i) => ({
        id: `${idPrefix}-${i}`,
        title: w._title,
        wide: w._columns >= 2,
        height: w._height,
        data: await w.data(),
      })),
  );

  const tables = await Promise.all(
    widgets
      .filter((w): w is TableWidget => w instanceof TableWidget)
      .map(async (w) => ({
        title: w._title,
        wide: w._wide,
        columns: w._columns.map((c) => ({ key: c.key, label: c.label })),
        rows: await w.rows(),
      })),
  );

  const chartScript = chartInitScript(
    charts.map((c) => ({
      id: c.id,
      type: c.data.type,
      labels: c.data.labels,
      datasets: c.data.datasets,
    })),
  );

  return (
    <div class="space-y-4">
      {statGroups.map((group) => (
        <div
          class={`grid grid-cols-1 gap-4 ${STAT_COLS[group.columns] ?? "sm:grid-cols-2 lg:grid-cols-4"}`}
        >
          {group.stats.map((s) => (
            <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-muted-foreground">{s._label}</p>
                {s._icon ? (
                  <span
                    class={`flex h-8 w-8 items-center justify-center rounded-lg ${STAT_TONE[s._tone]}`}
                  >
                    <Icon name={s._icon} class="h-4 w-4" />
                  </span>
                ) : null}
              </div>
              <p class="mt-2 text-3xl font-semibold tracking-tight">{String(s._value)}</p>
              {s._description ? (
                <p class="mt-1 text-xs text-muted-foreground">{s._description}</p>
              ) : null}
            </div>
          ))}
        </div>
      ))}

      {charts.length > 0 ? (
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {charts.map((c) => (
            <div
              class={`rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm ${c.wide ? "lg:col-span-2" : ""}`}
            >
              <h3 class="text-sm font-semibold">{c.title}</h3>
              <div class="mt-3" style={`position:relative;height:${c.height}px`}>
                <canvas id={c.id} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {chartScript ? <script dangerouslySetInnerHTML={{ __html: chartScript }} /> : null}

      {tables.map((t) => (
        <div
          class={`overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm ${t.wide ? "" : "lg:max-w-2xl"}`}
        >
          <div class="border-b border-border px-5 py-3">
            <h3 class="text-sm font-semibold">{t.title}</h3>
          </div>
          <div class="overflow-x-auto p-1.5">
            {t.rows.length > 0 ? (
              <Table columns={t.columns} rows={t.rows} hover />
            ) : (
              <p class="px-4 py-8 text-center text-sm text-muted-foreground">No data.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
