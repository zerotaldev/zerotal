/**
 * The request happening now, opened for you.
 *
 * What the panel is for, most of the time, is the page you are looking at — and
 * every other view made you go and find it first: open the panel, find the list,
 * pick the top row. This is that request already open, and it follows: load a
 * page, click something, and this is showing what just happened without a click
 * of its own.
 *
 * It renders the same sections a request opens into in the list, so there is one
 * description of what a request looks like rather than two that drift.
 */
import { dCls, esc, fmt, scCls } from "../ui/format.ts";
import { renderSections } from "./sections.ts";
import type { TabView } from "./types.ts";

/**
 * The newest request, rather than the pinned one.
 *
 * Pinning is how you hold still and read something older; this view is the
 * opposite gesture, so it deliberately ignores it. The two disagreeing is the
 * point — the status bar tells you what you pinned, this tells you what the page
 * just did.
 */
export const liveTab: TabView = {
  id: "live",
  label: "Live",
  scope: "session",
  live: true,
  volatile: true,
  standsAlone: true,

  badge({ store }) {
    const t = store.traces[0];
    if (!t) return undefined;
    return t.exception ? { count: "!", warn: true } : undefined;
  },

  render(host, ctx) {
    const trace = ctx.store.traces[0];
    if (!trace) {
      host.innerHTML =
        '<p class="empty">Nothing yet — load a page or click something to see it here</p>';
      return;
    }

    host.replaceChildren();

    // Which request this is, since the sections below describe it but none of
    // them names it.
    const head = document.createElement("div");
    head.className = "lvhead";
    head.innerHTML =
      `<span class="meth ${esc(trace.method.toLowerCase())}">${esc(trace.method)}</span>` +
      `<span class="hpath">${esc(trace.path)}</span>` +
      `<span class="sc ${scCls(trace.statusCode)}">${trace.statusCode || "—"}</span>` +
      `<span class="${dCls(trace.durationMs) || "dim"}">${fmt(trace.durationMs)}</span>` +
      `<span class="dim">${trace.queries.length}q</span>` +
      (trace.warnings.length ? '<span class="chip warn">N+1</span>' : "");
    host.appendChild(head);

    const body = document.createElement("div");
    renderSections(body, trace, ctx);
    host.appendChild(body);
  },
};
