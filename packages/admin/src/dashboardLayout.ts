/**
 * A dashboard each person can arrange for themselves.
 *
 * The dashboard is the page most people look at most often, and what belongs at
 * the top of it differs by role: the finance lead wants revenue first, support
 * wants the open-tickets table, and neither wants to scroll past the other's
 * widget every morning. So the order and visibility of widgets are a per-user
 * preference, not a code change.
 *
 * Deliberately order and visibility, and not a free-form canvas. Dragging boxes
 * around a grid is a large amount of machinery to maintain, and it mostly
 * produces layouts that break at the next screen width. Reordering and hiding
 * covers what people actually ask for, and it stays responsive by construction.
 *
 * Storage is the app's, for the same reason the saved views' is:
 *
 *   Panel.dashboardLayout({
 *     async load() { return Auth.user()?.dashboard ?? null; },
 *     async save(layout) { await Auth.user()?.update({ dashboard: layout }); },
 *   });
 *
 * With no store configured the dashboard renders in declaration order and the
 * arrange controls do not appear.
 */

/** One person's arrangement of the dashboard. */
export interface DashboardLayout {
  /** Widget keys in the order they should render. */
  order: string[];
  /** Widget keys this person has hidden. */
  hidden: string[];
}

/** Where a per-user layout is read from and written to. */
export interface DashboardLayoutStore {
  /** The current user's layout, or null when they have never arranged it. */
  load(): Promise<DashboardLayout | null> | DashboardLayout | null;
  /** Persist the current user's layout. */
  save(layout: DashboardLayout): Promise<void> | void;
}

/** An empty layout — the state before anyone has arranged anything. */
export const EMPTY_LAYOUT: DashboardLayout = { order: [], hidden: [] };

/**
 * Apply a layout to the widgets a panel declares.
 *
 * The declaration is the source of truth for *which* widgets exist; the layout
 * only says how to arrange them. So a widget added since the layout was saved
 * still appears (at the end, where it is noticeable rather than lost), and a
 * widget since removed does not resurrect because a stale key mentions it.
 */
export function applyLayout<T>(
  widgets: T[],
  keyOf: (widget: T, index: number) => string,
  layout: DashboardLayout | null,
): { visible: T[]; hidden: { key: string; widget: T }[] } {
  const keyed = widgets.map((widget, index) => ({ widget, key: keyOf(widget, index) }));
  if (!layout) return { visible: widgets, hidden: [] };

  const hiddenKeys = new Set(layout.hidden);
  const position = new Map(layout.order.map((key, index) => [key, index]));

  const ordered = [...keyed].sort((a, b) => {
    // Anything the layout does not mention is new, and sorts after everything
    // it does — so a widget added today is visible without being intrusive.
    const ai = position.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const bi = position.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });

  return {
    visible: ordered.filter((k) => !hiddenKeys.has(k.key)).map((k) => k.widget),
    hidden: ordered.filter((k) => hiddenKeys.has(k.key)),
  };
}

/** Move one key up or down, returning the new order. */
export function moveKey(order: string[], key: string, direction: -1 | 1): string[] {
  const from = order.indexOf(key);
  if (from === -1) return order;
  const to = from + direction;
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Fill in a layout's order from the widgets that actually exist.
 *
 * A layout saved when there were three widgets cannot reorder a fourth, so the
 * order is reconciled against the current keys before anything is moved.
 */
export function reconcile(layout: DashboardLayout | null, keys: string[]): DashboardLayout {
  const known = new Set(keys);
  const order = (layout?.order ?? []).filter((k) => known.has(k));
  for (const key of keys) if (!order.includes(key)) order.push(key);
  return { order, hidden: (layout?.hidden ?? []).filter((k) => known.has(k)) };
}
