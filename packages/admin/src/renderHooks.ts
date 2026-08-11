/**
 * Render hooks — named positions in the panel's chrome that anything can render
 * into, without owning the page it appears on.
 *
 * A contributed page can only add a *page*. A hook can add a banner above every
 * table, a badge beside the brand, a compliance notice under every form — the
 * small insertions that otherwise force a fork of the layout:
 *
 *   Panel.renderHook("page.header.end", () => <TrialBanner />);
 *   Panel.renderHook("table.start", (ctx) =>
 *     ctx.resource === "orders" ? <ShippingNotice /> : null,
 *   );
 *
 * A hook returning `null` renders nothing, which is what makes conditional
 * placement practical: register once, decide per render.
 */
import type { HtmlNode } from "@zerotal/flow";

/**
 * Where a hook renders. Named for the position rather than the markup, so the
 * panel's internals can change without breaking a registration.
 */
export type RenderHookName =
  /** Immediately inside the shell, above everything. */
  | "body.start"
  /** At the very end of the shell. */
  | "body.end"
  /** Beside the brand, at the top of the sidebar. */
  | "sidebar.start"
  /** Below the navigation, at the foot of the sidebar. */
  | "sidebar.end"
  /** In the top bar, before the panel's own controls. */
  | "topbar.start"
  /** In the top bar, after the notification bell and theme toggle. */
  | "topbar.end"
  /** Above a page's heading. */
  | "page.header.start"
  /** Below a page's heading and actions. */
  | "page.header.end"
  /** Directly above a resource's table. */
  | "table.start"
  /** Directly below a resource's table. */
  | "table.end"
  /** Above a create/edit form's fields. */
  | "form.start"
  /** Below a form's fields, above its buttons. */
  | "form.end"
  /** Above a record's infolist. */
  | "record.start"
  /** Below a record's infolist. */
  | "record.end";

/** What a hook knows about where it is rendering. */
export interface RenderHookContext {
  /** Slug of the resource being rendered, when there is one. */
  resource?: string | undefined;
  /** Which screen: the list, a record, a form, or the dashboard. */
  page?: "list" | "record" | "form" | "dashboard" | undefined;
  /** The record's id, on a record or edit screen. */
  recordId?: string | undefined;
}

export type RenderHook = (context: RenderHookContext) => HtmlNode | string | null;

/**
 * Resolve every hook registered at `name`, dropping the ones that declined to
 * render and the ones that threw.
 *
 * A hook is decoration: it must not be able to take down the page it decorates,
 * so a throwing hook is logged and skipped rather than propagated.
 *
 * @internal
 */
export function resolveRenderHooks(
  hooks: RenderHook[],
  context: RenderHookContext = {},
): (HtmlNode | string)[] {
  const out: (HtmlNode | string)[] = [];
  for (const hook of hooks) {
    try {
      const node = hook(context);
      if (node !== null && node !== undefined) out.push(node);
    } catch (error) {
      console.error("[Zerotal Admin] render hook failed:", error);
    }
  }
  return out;
}
