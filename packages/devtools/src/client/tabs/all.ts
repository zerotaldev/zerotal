/**
 * The request history: filter, facets, correlated groups, and a windowed list.
 *
 * The tab that redraws most, because every request changes it — which is why it
 * is the one that reconciles rather than rebuilding. Three things depend on that:
 * the caret in the filter box, the scroll position, and the open state of every
 * expanded group all used to be thrown away by each arriving request.
 */
import { facetsActive, methodsPresent, noFacets, type Facets } from "../filter.ts";
import { foldTraceRows, type TraceRow } from "../tree.ts";
import { dCls, esc, fmt, scCls } from "../ui/format.ts";
import { el, reconcile } from "../ui/render.ts";
import type { TabContext, TabView } from "./types.ts";
import type { RequestTrace } from "../../RequestTrace.ts";
import { renderSections } from "./sections.ts";

/**
 * Row height in pixels, which the stylesheet pins.
 *
 * The windowing below positions rows arithmetically rather than measuring them,
 * so a row that could grow would put every offset out. `.hrow` is fixed at this
 * height for exactly that reason.
 */
const ROW_H = 26;

/** Above this many rows the list is windowed; below it, drawn whole. */
const VIRTUAL_THRESHOLD = 200;

/** Rows drawn beyond each edge of the viewport, so a fast scroll finds them there. */
const OVERSCAN = 8;

const STATUS_CLASSES: Array<[string, string]> = [
  ["2", "2xx"],
  ["3", "3xx"],
  ["4", "4xx"],
  ["5", "5xx"],
];

// ── Skeleton ──────────────────────────────────────────────────────────────────
//
// Built once per visit to the tab and then only updated. The filter input in
// particular must never be re-created: an input rebuilt under a typing user is an
// input that loses the caret on every keystroke, which the old panel worked
// around by re-focusing and re-selecting after each render.

function skeleton(): string {
  return (
    `<div class="fbar">` +
    `<input id="filter" class="finput" type="search" ` +
    `placeholder="Filter by path, method, status, or controller…">` +
    `<span class="dim" id="fcount"></span>` +
    `</div>` +
    `<div class="facets" id="facets"></div>` +
    `<div id="rowswrap">` +
    `<div class="vpad" id="padtop"></div>` +
    `<div id="rows"></div>` +
    `<div class="vpad" id="padbot"></div>` +
    `</div>`
  );
}

/**
 * The facet chips.
 *
 * Method chips come from the traces actually recorded — listing every HTTP verb
 * would put five dead chips on screen for an app that only ever GETs.
 */
function facetChips(store: TabContext["store"]): string {
  const f = store.facets;
  const chip = (kind: string, value: string, label: string, on: boolean, warn = false): string =>
    `<button class="fchip${on ? " on" : ""}${warn ? " warn" : ""}" ` +
    `data-facet="${esc(kind)}" data-value="${esc(value)}">${esc(label)}</button>`;

  const methods = methodsPresent(store.traces)
    .map((m) => chip("method", m, m, f.methods.includes(m)))
    .join("");
  const statuses = STATUS_CLASSES.map(([digit, label]) =>
    chip("status", digit, label, f.statusClasses.includes(digit)),
  ).join("");

  return (
    methods +
    (methods ? `<span class="fsep"></span>` : "") +
    statuses +
    `<span class="fsep"></span>` +
    chip("errors", "", "errors", f.errors, true) +
    chip("slow", "", "slow", f.slow, true) +
    chip("nplus", "", "n+1", f.nPlusOne, true) +
    (facetsActive(f) ? `<span class="fsep"></span>` + chip("clear", "", "✕ clear", false) : "")
  );
}

/** Apply one chip click to the facet set, returning a new one. */
export function toggleFacet(f: Facets, kind: string, value: string): Facets {
  const drop = <T>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  switch (kind) {
    case "method":
      return { ...f, methods: drop(f.methods, value) };
    case "status":
      return { ...f, statusClasses: drop(f.statusClasses, value) };
    case "errors":
      return { ...f, errors: !f.errors };
    case "slow":
      return { ...f, slow: !f.slow };
    case "nplus":
      return { ...f, nPlusOne: !f.nPlusOne };
    case "clear":
      return noFacets();
    default:
      return f;
  }
}

// ── Rows ──────────────────────────────────────────────────────────────────────

/** A row's identity across redraws — the trace, plus where it sits in its group. */
function rowKey(r: TraceRow): string {
  return `${r.trace.id}:${r.child ? "c" : "h"}`;
}

/** What the list draws: request rows, and the detail of whichever one is open. */
type DrawItem = { kind: "row"; row: TraceRow } | { kind: "detail"; trace: RequestTrace };

function itemKey(item: DrawItem): string {
  return item.kind === "detail" ? `${item.trace.id}:d` : rowKey(item.row);
}

function rowHtml(r: TraceRow, selectedId: string | undefined, openId: string | null): string {
  const t = r.trace;
  const toggle = r.groupKey
    ? `<button class="gtog" data-group="${esc(r.groupKey)}" title="Requests in this batch">` +
      `+${r.groupSize}</button>`
    : "";
  return (
    `<div class="hrow${t.id === selectedId ? " cur" : ""}${t.exception ? " err" : ""}` +
    `${r.child ? " child" : ""}" data-idx="${r.index}">` +
    `<span class="hchev">${t.id === openId ? "▾" : "▸"}</span>` +
    `<span class="meth ${t.method.toLowerCase()}">${esc(t.method)}</span>` +
    `<span class="hpath">${esc(t.path)}</span>` +
    // The message, not just the status: scanning a list for the request that
    // broke is the reason to open this tab.
    (t.exception
      ? `<span class="hexc" title="${esc(t.exception.message)}">${esc(t.exception.message)}</span>`
      : "") +
    toggle +
    `<span class="sc ${scCls(t.statusCode)}">${t.statusCode || "—"}</span>` +
    `<span class="${dCls(t.durationMs) || "dim"}">${fmt(t.durationMs)}</span>` +
    `<span class="dim">${t.queries.length}q</span>` +
    (t.warnings.length ? '<span class="chip warn">N+1</span>' : "") +
    `</div>`
  );
}

/**
 * Which slice of the list to actually draw.
 *
 * Below the threshold, all of it — windowing a short list costs more than it
 * saves and makes `Ctrl+F` in the browser useless for no reason. Above it, only
 * what the viewport can show plus an overscan, with two spacers standing in for
 * the height of everything else.
 */
export function windowRange(
  total: number,
  scrollTop: number,
  viewportH: number,
  headerH: number,
): { first: number; count: number } {
  if (total <= VIRTUAL_THRESHOLD) return { first: 0, count: total };
  const above = Math.max(0, scrollTop - headerH);
  const visible = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2;
  // Clamped at both ends. Without the upper clamp a scroll offset past the list —
  // which happens for one frame whenever the list shrinks under a scrolled
  // viewport, as it does on every clear — asks for a window starting beyond the
  // end, and the count comes back negative.
  const first = Math.max(0, Math.min(Math.floor(above / ROW_H) - OVERSCAN, total - visible));
  return { first, count: Math.min(visible, total - first) };
}

function draw(host: HTMLElement, ctx: TabContext): void {
  const { store } = ctx;
  const rowsHost = host.querySelector<HTMLElement>("#rows");
  const wrap = host.querySelector<HTMLElement>("#rowswrap");
  const padTop = host.querySelector<HTMLElement>("#padtop");
  const padBot = host.querySelector<HTMLElement>("#padbot");
  if (!rowsHost || !wrap || !padTop || !padBot) return;

  const matches = store.visible();
  const rows = foldTraceRows(matches, store.channels, store.expanded);

  const count = host.querySelector<HTMLElement>("#fcount");
  if (count) count.textContent = `${matches.length}/${store.traces.length}`;

  if (!rows.length) {
    padTop.style.height = "0px";
    padBot.style.height = "0px";
    rowsHost.innerHTML = `<p class="empty">No requests match this filter</p>`;
    return;
  }

  // `host` *is* the scroller — the tab renders straight into the content pane,
  // which is what scrolls. The rows start below the sticky filter bar and the
  // facet strip, so the window is offset by the wrapper's position rather than
  // measured from zero.
  //
  // Windowing is suspended while a request is open, because an open detail is a
  // row of unknown height and every offset here is arithmetic on a fixed one.
  // The store keeps 100 traces and the threshold is 200, so in practice this
  // draws the same whole list it would have drawn anyway; the guard is for the
  // correlated-group case that can fold more rows than traces.
  const openId = store.openTraceId;
  const { first, count: take } = openId
    ? { first: 0, count: rows.length }
    : windowRange(rows.length, host.scrollTop, host.clientHeight || 0, wrap.offsetTop);
  const slice = rows.slice(first, first + take);

  padTop.style.height = `${first * ROW_H}px`;
  padBot.style.height = `${Math.max(0, rows.length - first - take) * ROW_H}px`;

  // The open request's detail rides in the list as its own item, so the
  // reconciler keeps it across redraws — rebuilding it on every arriving request
  // would collapse whatever the reader had scrolled to inside it.
  const items: DrawItem[] = [];
  for (const row of slice) {
    items.push({ kind: "row", row });
    if (openId && row.trace.id === openId && !row.child) {
      items.push({ kind: "detail", trace: row.trace });
    }
  }

  const selectedId = store.selected?.id;
  reconcile(
    rowsHost,
    items,
    itemKey,
    (item) => {
      if (item.kind === "detail") {
        const node = document.createElement("div");
        node.className = "hdetail";
        renderSections(node, item.trace, ctx);
        node.setAttribute("data-detail-rev", String(store.revision));
        return node;
      }
      const html = rowHtml(item.row, selectedId, openId);
      const node = el(html);
      // Stamped on creation as well, so the very next update compares equal and
      // a row that has not changed is never rewritten.
      node.setAttribute("data-html", html);
      return node;
    },
    // Refilled in place rather than patched field by field: a row is six spans,
    // and the reconciler's job — keeping the *node* so scroll position and text
    // selection survive — is already done by the time this runs. The markup is
    // compared first, so a steady list generates no DOM writes at all.
    (node, item) => {
      if (item.kind === "detail") {
        // Redrawn only when the store actually moved. The sections below are
        // whole tab renderers; running them on every keystroke in the filter box
        // would be the most expensive thing in the panel.
        const rev = String(store.revision);
        if (node.getAttribute("data-detail-rev") === rev) return;
        renderSections(node, item.trace, ctx);
        node.setAttribute("data-detail-rev", rev);
        return;
      }
      const next = rowHtml(item.row, selectedId, openId);
      if (node.getAttribute("data-html") === next) return;
      const fresh = el(next);
      node.className = fresh.className;
      node.replaceChildren(...Array.from(fresh.childNodes));
      node.setAttribute("data-idx", String(item.row.index));
      node.setAttribute("data-html", next);
    },
  );
}

export const allTab: TabView = {
  id: "all",
  label: "All",
  scope: "session",
  live: true,
  volatile: true,
  standsAlone: true,

  badge: ({ store }) => ({ count: store.traces.length }),

  render(host, ctx) {
    if (!ctx.store.traces.length) {
      host.innerHTML =
        '<p class="empty">No requests recorded yet — make a request to see it here</p>';
      return;
    }
    // Rebuild the frame only when it is not already there — switching tabs away
    // and back replaces the content host's children, arriving traces do not.
    if (!host.querySelector("#rowswrap")) {
      host.innerHTML = skeleton();
      const input = host.querySelector<HTMLInputElement>("#filter");
      if (input) input.value = ctx.store.filter;
    }
    // Rewritten only when it actually differs. Otherwise every arriving request
    // replaces the strip, which throws away keyboard focus on a chip the user is
    // tabbing through for a set of buttons that did not change.
    const facets = host.querySelector<HTMLElement>("#facets");
    if (facets) {
      const next = facetChips(ctx.store);
      if (facets.dataset["sig"] !== next) {
        facets.innerHTML = next;
        facets.dataset["sig"] = next;
      }
    }
    draw(host, ctx);
  },

  // Windowing means the visible slice is a function of the scroll offset, so the
  // list has to be redrawn as it moves — but only the list.
  onScroll(host, ctx) {
    if (host.querySelector("#rowswrap")) draw(host, ctx);
  },
};
