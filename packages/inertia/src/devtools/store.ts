/**
 * Where recorded entries live between being written and being read.
 *
 * A bounded in-memory ring, not a directory of files. The Laravel adapter
 * persists to `storage/inertia-devtools` because a PHP process does not outlive
 * the request that created the entry; a Bun server does, so the entries are
 * simply kept in the process that recorded them. That removes disk IO from the
 * request path, removes a pruning job, and removes the question of what happens
 * when two workers write the same directory.
 *
 * What it costs: entries do not survive a restart, so a crash takes its own
 * timeline with it. For a tool you read while the server is up, that is the
 * right trade — and `zt dev` restarts on every save, which would invalidate a
 * persisted timeline anyway.
 *
 * The store is capped by count. An unbounded recorder is a memory leak with a
 * friendly name: a long-lived dev server serving a busy SPA would hold every
 * prop bag it ever rendered.
 */
import type { DevtoolsEntry, DevtoolsListQuery, DevtoolsRequestType } from "./types.ts";

/** How many entries are kept before the oldest is dropped. */
export const DEFAULT_MAX_ENTRIES = 200;

let _entries: DevtoolsEntry[] = [];
let _max = DEFAULT_MAX_ENTRIES;

/** Set the cap and drop anything already over it. */
export function setMaxEntries(max: number): void {
  _max = Math.max(1, Math.floor(max));
  if (_entries.length > _max) _entries = _entries.slice(-_max);
}

/** The current cap. */
export function maxEntries(): number {
  return _max;
}

/** Store an entry, dropping the oldest once the cap is reached. */
export function putEntry(entry: DevtoolsEntry): void {
  _entries.push(entry);
  if (_entries.length > _max) _entries.shift();
}

/** Look one entry up by id. */
export function getEntry(id: string): DevtoolsEntry | undefined {
  return _entries.find((entry) => entry.__meta.id === id);
}

/** Drop everything. Used between tests and by the panel's "clear" action. */
export function clearEntries(): void {
  _entries = [];
}

/** How many entries are currently held. */
export function entryCount(): number {
  return _entries.length;
}

/**
 * List entries newest-first, applying the read API's filters.
 *
 * `exclude` is applied after `type` so a request naming both keeps the
 * intersection, which is what the extension expects when it asks for "all
 * navigations except prefetches".
 *
 * @param query - Filters from the request's query string.
 */
export function listEntries(query: DevtoolsListQuery = {}): DevtoolsEntry[] {
  let out = _entries.slice().reverse();

  if (query.component !== undefined) {
    out = out.filter((entry) => entry.__meta.component === query.component);
  }
  if (query.type && query.type.length > 0) {
    const keep = new Set<string>(query.type);
    out = out.filter((entry) => keep.has(entry.__meta.requestType));
  }
  if (query.exclude && query.exclude.length > 0) {
    const drop = new Set<string>(query.exclude);
    out = out.filter((entry) => !drop.has(entry.__meta.requestType));
  }

  // Slice last: offset and limit page the *filtered* list, so paging through a
  // filtered view does not skip entries the filter already removed.
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit;
  return limit === undefined ? out.slice(offset) : out.slice(offset, offset + Math.max(0, limit));
}

/** Parse the read API's query string into a {@link DevtoolsListQuery}. */
export function parseListQuery(params: URLSearchParams): DevtoolsListQuery {
  const query: DevtoolsListQuery = {};

  const component = params.get("component");
  if (component !== null) query.component = component;

  const csv = (value: string | null): string[] | undefined => {
    if (value === null) return undefined;
    const parts = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  };

  // Cast to the element type, not to `DevtoolsListQuery["type"]` — that includes
  // `undefined`, which re-widens the value the `if` just narrowed.
  const type = csv(params.get("type"));
  if (type) query.type = type as DevtoolsRequestType[];
  const exclude = csv(params.get("exclude"));
  if (exclude) query.exclude = exclude as DevtoolsRequestType[];

  const num = (value: string | null): number | undefined => {
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const offset = num(params.get("offset"));
  if (offset !== undefined) query.offset = offset;
  const limit = num(params.get("limit"));
  if (limit !== undefined) query.limit = limit;

  return query;
}
