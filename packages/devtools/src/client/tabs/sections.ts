/**
 * A request, drawn as sections rather than as a strip of tabs.
 *
 * Twelve request-scoped tabs is twelve headings that are empty for most requests
 * and answer a question you can only ask about a request you have already
 * picked. They are rendered inside the request instead — by calling the views
 * themselves, since a `TabView` is already "draw this trace into this element",
 * which is exactly what a section is. Nothing here reimplements a view.
 *
 * Shared by the request list, where a row opens into its own detail, and by the
 * Live view, which shows the newest request without your having to open anything.
 */
import type { RequestTrace } from "../../RequestTrace.ts";
import type { TabContext, TabView } from "./types.ts";

/** Whether a view drew anything beyond its own "nothing here" line. */
export function isEmptyRender(body: HTMLElement): boolean {
  if (!body.textContent?.trim()) return true;
  const kids = Array.from(body.children);
  return kids.length > 0 && kids.every((k) => k.classList.contains("empty"));
}

/**
 * Draw every request-scoped view that has something to say about `trace`.
 *
 * A view is asked for its count first and skipped when it counts nothing —
 * the queries view renders a stats strip even for a request that ran none, and a
 * "Queries 0" heading over it is exactly the empty furniture this replaces. What
 * survives that is rendered and then dropped anyway if what came back is only the
 * view's own empty-state line, so a request that sent no mail has no Mail
 * heading rather than a heading over the word "none".
 */
export function renderSections(hostEl: HTMLElement, trace: RequestTrace, ctx: TabContext): void {
  hostEl.replaceChildren();
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

    hostEl.appendChild(sectionFor(view, badge, body));
  }
  if (!hostEl.children.length) {
    hostEl.innerHTML = `<p class="empty">Nothing else was recorded for this request</p>`;
  }
}

function sectionFor(
  view: TabView,
  badge: ReturnType<NonNullable<TabView["badge"]>>,
  body: HTMLElement,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "dsec";

  const heading = document.createElement("div");
  heading.className = "dsec-h";
  heading.textContent = view.label;
  if (badge) {
    const count = document.createElement("span");
    count.className = `dsec-n${badge.warn ? " warn" : ""}`;
    count.textContent = String(badge.count);
    heading.appendChild(count);
  }

  section.append(heading, body);
  return section;
}
