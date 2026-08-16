/**
 * The App section: the framework as it *is*, rather than as it just behaved.
 *
 * Every other tab reads the trace stream — what one request did. These six read
 * the framework's own registries, which existed all along and were CLI-only or
 * invisible. All six share one fetch, because they are one read of one map and
 * six requests for it would be six answers that can disagree.
 */
import { esc, fmt } from "../ui/format.ts";
import type { Store } from "../state.ts";
import type { TabContext, TabView } from "./types.ts";

/** One route, as the map serves it. */
interface RouteRow {
  method: string;
  path: string;
  name: string;
  handler: string;
  middleware: string;
}
interface BindingRow {
  token: string;
  kind: string;
  provider: string;
}
interface ProviderRow {
  name: string;
  durationMs: number;
  bindings: number;
}
interface EventRow {
  event: string;
  listeners: string;
  source: string;
}
interface ActivityRow {
  kind: string;
  name: string;
  outcome: string;
  durationMs: number;
  at: number;
  failed: boolean;
  detail?: string;
}

export interface FrameworkMap {
  routes: RouteRow[];
  config: Record<string, unknown>;
  bindings: BindingRow[];
  providers: ProviderRow[];
  events: EventRow[];
  activity: ActivityRow[];
  bootMs: number | null;
}

// ── Shared fetch ──────────────────────────────────────────────────────────────
//
// One read, shared by six tabs. Kept out of the store because it is not part of
// what the panel *is* — it is a thing the App section goes and gets, and a store
// field for it would make every request-tab render depend on it.

let _map: FrameworkMap | null = null;
let _loading = false;
let _error: string | null = null;

/** Drop the cached map so the next render re-reads it. */
export function invalidateMap(): void {
  _map = null;
  _error = null;
}

/**
 * Fetch the map once, then serve it from memory.
 *
 * Cached because the registries are static for the life of the process and six
 * tabs share one answer; refreshed on demand by the button each tab carries,
 * for the case where a provider registered a route late.
 */
function loadMap(store: Store, redraw: () => void): void {
  if (_map || _loading) return;
  _loading = true;
  void fetch(`${store.base}/api/map`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data: FrameworkMap) => {
      _map = data;
      _error = null;
    })
    .catch((e: unknown) => {
      _error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      _loading = false;
      redraw();
    });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '<p class="empty">Nothing registered</p>';
  return (
    `<table class="ctbl"><thead><tr>` +
    headers.map((h) => `<th>${esc(h)}</th>`).join("") +
    `</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
    `</tbody></table>`
  );
}

/** The refresh affordance every App tab carries, since the map is cached. */
function header(title: string, count: number, extra = ""): string {
  return (
    `<div class="fbar">` +
    `<b>${esc(title)}</b><span class="dim">${count}</span>` +
    (extra ? `<span class="dim">${extra}</span>` : "") +
    `<span class="sp" style="flex:1"></span>` +
    `<button class="ibtn" data-map-refresh="1" title="Re-read the registries">↻</button>` +
    `</div>`
  );
}

/**
 * Build one App tab.
 *
 * All six share the fetch, the loading state, and the refresh button; only the
 * body differs. Written as a factory rather than six near-identical files
 * because the difference between them really is one function.
 */
function appTab(
  id: string,
  label: string,
  body: (map: FrameworkMap, ctx: TabContext) => string,
  count: (map: FrameworkMap) => number,
): TabView {
  return {
    id: `app:${id}`,
    scope: "session",
    label,
    standsAlone: true,
    volatile: true,
    render(host, ctx) {
      if (_error) {
        host.innerHTML =
          header(label, 0) + `<p class="empty">Could not read the map — ${esc(_error)}</p>`;
        return;
      }
      if (!_map) {
        loadMap(ctx.store, () => ctx.store.changed());
        host.innerHTML = '<p class="empty">Reading the application…</p>';
        return;
      }
      host.innerHTML = header(label, count(_map)) + body(_map, ctx);
    },
  };
}

/** Flatten the config tree to dotted paths, which is how you look a value up. */
function flattenConfig(value: unknown, prefix = "", out: Array<[string, unknown]> = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenConfig(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out.push([prefix, value]);
  return out;
}

export const routesTab = appTab(
  "routes",
  "Routes",
  (map) =>
    table(
      ["", "path", "name", "handler", "middleware"],
      map.routes.map((r) => [
        `<span class="meth ${r.method.toLowerCase()}">${esc(r.method)}</span>`,
        // Click to navigate: a route list you cannot go to is a list you copy
        // out of. Only GETs — nothing here should POST on a click.
        r.method === "GET"
          ? `<a class="link" href="${esc(r.path)}" target="_blank">${esc(r.path)}</a>`
          : esc(r.path),
        r.name ? `<span class="chip">${esc(r.name)}</span>` : '<span class="dim">—</span>',
        esc(r.handler),
        `<span class="dim">${esc(r.middleware || "—")}</span>`,
      ]),
    ),
  (map) => map.routes.length,
);

export const configTab = appTab(
  "config",
  "Config",
  (map) =>
    table(
      ["path", "value"],
      flattenConfig(map.config).map(([path, value]) => [
        `<b>${esc(path)}</b>`,
        `<span class="dim">${esc(
          value === null || value === undefined
            ? String(value)
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value),
        )}</span>`,
      ]),
    ) +
    `<p class="dim" style="font-size:10px;padding:6px 12px">` +
    `Anything whose key reads as a secret is masked by the same rule the Queries tab uses.</p>`,
  (map) => flattenConfig(map.config).length,
);

export const containerTab = appTab(
  "container",
  "Container",
  (map) =>
    table(
      ["token", "kind", "bound by"],
      map.bindings.map((b) => [
        `<b>${esc(b.token)}</b>`,
        `<span class="chip">${esc(b.kind)}</span>`,
        `<span class="dim">${esc(b.provider)}</span>`,
      ]),
    ),
  (map) => map.bindings.length,
);

export const providersTab = appTab(
  "providers",
  "Providers",
  (map) =>
    table(
      ["#", "provider", "boot", "bindings"],
      map.providers.map((p, i) => [
        `<span class="dim">${i + 1}</span>`,
        `<b>${esc(p.name)}</b>`,
        `<span class="${p.durationMs > 50 ? "yellow" : "dim"}">${fmt(p.durationMs)}</span>`,
        `<span class="dim">${p.bindings || "—"}</span>`,
      ]),
    ) +
    `<p class="dim" style="font-size:10px;padding:6px 12px">` +
    `In boot order — which decides who wins a contested binding. ` +
    (map.bootMs === null ? "" : `Total boot ${fmt(Math.round(map.bootMs))}. `) +
    `The <code>onBooted</code> phase runs concurrently, so these overlap rather than summing.</p>`,
  (map) => map.providers.length,
);

export const eventsTab = appTab(
  "events",
  "Events",
  (map) =>
    table(
      ["event", "reacts", "bus"],
      map.events.map((e) => [
        `<b>${esc(e.event)}</b>`,
        esc(e.listeners),
        `<span class="dim">${esc(e.source)}</span>`,
      ]),
    ),
  (map) => map.events.length,
);

export const activityTab = appTab(
  "activity",
  "Commands",
  (map) =>
    map.activity.length
      ? table(
          ["", "name", "outcome", "took", "when"],
          map.activity.map((a) => [
            `<span class="chip">${esc(a.kind)}</span>`,
            `<b>${esc(a.name)}</b>` +
              (a.detail ? `<div class="dim" style="font-size:10px">${esc(a.detail)}</div>` : ""),
            `<span class="${a.failed ? "red" : "dim"}">${esc(a.outcome)}</span>`,
            `<span class="dim">${a.durationMs ? fmt(a.durationMs) : "—"}</span>`,
            `<span class="dim">${esc(new Date(a.at).toLocaleTimeString())}</span>`,
          ]),
        )
      : // A scheduled task that fails at 03:00 used to leave no trace anywhere;
        // an empty feed here means nothing has run yet, not that nothing is
        // recorded.
        '<p class="empty">No commands or scheduled tasks have run in this process yet</p>',
  (map) => map.activity.length,
);

/** The App section's tabs, in strip order. */
export const APP_TABS: TabView[] = [
  routesTab,
  configTab,
  containerTab,
  providersTab,
  eventsTab,
  activityTab,
];
