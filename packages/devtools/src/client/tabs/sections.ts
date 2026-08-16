/**
 * A request, drawn as its own small set of tabs.
 *
 * Twelve request-scoped tabs in the panel's main strip is twelve headings that
 * are empty for most requests and answer a question you can only ask about a
 * request you have already picked. They belong to the request, so they are drawn
 * inside it — by calling the views themselves, since a `TabView` is already
 * "draw this trace into this element", which is exactly what a section is.
 * Nothing here reimplements a view.
 *
 * Tabs rather than a stack, because the sections are alternatives: you are
 * reading the queries *or* the headers *or* the waterfall, and stacking them
 * makes you scroll past two to reach the third. Only the ones with something to
 * say appear, so the strip is also the summary — a request with a Queries, a
 * Logs and an Exception tab has already told you what happened before you click
 * anything.
 *
 * Shared by the request list, where a row opens into its own detail, and by the
 * Live view, which shows the newest request without your having to open anything.
 */
import type { RequestTrace } from "../../RequestTrace.ts";
import { esc } from "../ui/format.ts";
import type { TabContext, TabView } from "./types.ts";

/** Whether a view drew anything beyond its own "nothing here" line. */
export function isEmptyRender(body: HTMLElement): boolean {
  if (!body.textContent?.trim()) return true;
  const kids = Array.from(body.children);
  return kids.length > 0 && kids.every((k) => k.classList.contains("empty"));
}

interface Drawn {
  view: TabView;
  badge: ReturnType<NonNullable<TabView["badge"]>>;
  body: HTMLElement;
}

/**
 * Render every request-scoped view that has something to say about `trace`.
 *
 * A view is asked for its count first and skipped when it counts nothing — the
 * queries view renders a stats strip even for a request that ran none, and a
 * "Queries 0" heading over it is exactly the empty furniture this replaces. What
 * survives that is rendered and then dropped anyway if what came back is only the
 * view's own empty-state line, so a request that sent no mail has no Mail tab
 * rather than a tab holding the word "none".
 *
 * Every surviving body is kept in the DOM and hidden rather than re-rendered on
 * each switch: they are whole tab renderers, and the flick between two of them
 * should cost nothing.
 */
export function renderSections(hostEl: HTMLElement, trace: RequestTrace, ctx: TabContext): void {
  hostEl.replaceChildren();

  const drawn: Drawn[] = [];
  for (const view of ctx.sections ?? []) {
    const badge = view.badge?.({ trace, store: ctx.store });
    if (badge && Number(badge.count) === 0) continue;

    const body = document.createElement("div");
    body.className = "dsec-body";
    try {
      view.render(body, { trace, store: ctx.store });
    } catch {
      // A view that throws must not take the request it belongs to with it.
      continue;
    }
    if (isEmptyRender(body)) continue;
    drawn.push({ view, badge, body });
  }

  if (!drawn.length) {
    hostEl.innerHTML = `<p class="empty">Nothing else was recorded for this request</p>`;
    return;
  }

  const activeId = activeSection(
    ctx.store.sectionTab,
    drawn.map((d) => d.view.id),
  );

  const strip = document.createElement("div");
  strip.className = "dsecs";
  strip.innerHTML = drawn
    .map(({ view, badge }) => {
      const count = badge
        ? `<span class="dsec-n${badge.warn ? " warn" : ""}">${esc(String(badge.count))}</span>`
        : "";
      return (
        `<button class="dsect${view.id === activeId ? " on" : ""}" ` +
        `data-sec="${esc(view.id)}">${esc(view.label)}${count}</button>`
      );
    })
    .join("");
  hostEl.appendChild(strip);

  for (const { view, body } of drawn) {
    const pane = document.createElement("div");
    pane.className = "dsec-pane";
    if (view.id !== activeId) pane.style.display = "none";
    pane.appendChild(body);
    hostEl.appendChild(pane);
  }
}

/**
 * Which section to show: the one you were reading, or the first this request has.
 *
 * Falling back rather than clearing the preference — move from a request with
 * queries to one without and you get its first section, but the one after that
 * with queries again puts you back where you were.
 */
export function activeSection(preferred: string, available: string[]): string {
  return available.includes(preferred) ? preferred : (available[0] ?? "");
}
