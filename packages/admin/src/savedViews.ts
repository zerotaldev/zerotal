/**
 * Saved views — a list, the way someone left it.
 *
 * Every bit of list state already lives in the URL: search, filters, tab, sort,
 * column visibility, grouping, page size. Saving a view is therefore saving a
 * query string, and restoring one is a link. That is the whole idea.
 *
 * Persistence is the app's, for the same reason the notification centre's is:
 * where a view belongs — a table, a user preference blob, local config — depends
 * on the application, not on the panel.
 *
 *   Panel.savedViews({
 *     async list(resource) {
 *       return (await View.query().where("resource", resource).get()).map(toView);
 *     },
 *     async save(view) { await View.create({ ...view, userId: Auth.user()!.id }); },
 *     async remove(id) { await View.destroy(id); },
 *   });
 *
 * With no provider configured the Views control simply doesn't appear.
 */

/** A stored view: a name, the resource it belongs to, and the query it restores. */
export interface SavedView {
  id: string;
  /** Resource slug this view belongs to. */
  resource: string;
  name: string;
  /** The list's query string, without the leading `?`. */
  query: string;
  /** Show this view to everyone rather than only its author. */
  shared?: boolean;
}

/** What the app supplies so views can be listed, saved and deleted. */
export interface SavedViewProvider {
  /** Views for a resource, in the order they should appear. */
  list(resource: string): Promise<SavedView[]> | SavedView[];
  /** Persist a new view. The panel supplies everything but the id. */
  save(view: Omit<SavedView, "id">): Promise<void> | void;
  /** Delete one by id. */
  remove(id: string): Promise<void> | void;
}

/**
 * The query-string keys a saved view carries.
 *
 * Deliberately explicit rather than "everything in the URL": a saved view should
 * restore how the list was *shaped*, not which page of it happened to be open,
 * so `page` is excluded and a restored view always starts at the top.
 */
export const VIEW_PARAMS = [
  "search",
  "filters",
  "tab",
  "sortBy",
  "sortDir",
  "sort",
  "trashed",
  "perPage",
  "cols",
  "group",
] as const;

/** Reduce a full query string to just the parts a view restores. */
export function viewQuery(params: URLSearchParams | string): string {
  const source = typeof params === "string" ? new URLSearchParams(params) : params;
  const out = new URLSearchParams();
  for (const key of VIEW_PARAMS) {
    const value = source.get(key);
    if (value != null && value !== "") out.set(key, value);
  }
  return out.toString();
}

/** Whether a view matches the list's current state — used to mark the active one. */
export function viewIsActive(view: SavedView, current: URLSearchParams | string): boolean {
  return viewQuery(view.query) === viewQuery(current);
}
