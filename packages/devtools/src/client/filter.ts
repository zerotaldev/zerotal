/**
 * Which traces the All tab shows.
 *
 * Two independent narrowings that compose with AND: free text, and facets. Text
 * answers "the request I am thinking of"; facets answer "the kind of request I am
 * hunting" — and a list you can only search by name is one you cannot ask "show
 * me the failures" of.
 *
 * All of it is pure, and none of it touches the DOM: this is the part of the
 * panel that is logic rather than markup, and it is worth testing without a
 * browser.
 */
import type { RequestTrace } from "../RequestTrace.ts";
import { requestKind, type RequestKind } from "./kind.ts";

/**
 * A request slower than this reads as slow.
 *
 * The same boundary the duration colour already uses, so the `slow` facet
 * selects exactly the rows that were already amber or red — a filter that
 * disagreed with the colouring next to it would be worse than no filter.
 */
export const SLOW_MS = 300;

/** The non-text narrowings, each empty or false meaning "do not narrow by this". */
export interface Facets {
  /** Uppercase method names. Empty means every method. */
  methods: string[];
  /** Status classes as their leading digit — `"2"`, `"4"`, … Empty means every status. */
  statusClasses: string[];
  /** Only requests that threw. */
  errors: boolean;
  /** Only requests slower than {@link SLOW_MS}. */
  slow: boolean;
  /** Only requests with an N+1 warning. */
  nPlusOne: boolean;
  /**
   * Request kinds to show. Empty means every kind.
   *
   * The one facet whose usual job is *subtraction*: an app's own traffic is
   * `document` and `api`, and picking those two is how you get a list without
   * fifty stylesheet fetches in it. Picking `asset` alone is the other half —
   * what the browser pulled in, what it cost, and which of it 404'd, which is
   * not visible anywhere else.
   *
   * Optional because {@link Facets} is exported from `@zerotal/devtools/client`
   * and a required field added to a published interface breaks whoever builds one
   * by hand. `noFacets()` always sets it; reads here tolerate its absence.
   */
  kinds?: RequestKind[];
}

/** No narrowing at all — what a fresh panel starts with. */
export function noFacets(): Facets {
  return { methods: [], statusClasses: [], errors: false, slow: false, nPlusOne: false, kinds: [] };
}

/** Whether any facet is actually narrowing, for the "clear" affordance. */
export function facetsActive(f: Facets): boolean {
  return (
    f.methods.length > 0 ||
    f.statusClasses.length > 0 ||
    (f.kinds?.length ?? 0) > 0 ||
    f.errors ||
    f.slow ||
    f.nPlusOne
  );
}

/**
 * Match a trace against the All tab's filter box.
 *
 * Every space-separated term has to match, so `posts 500` narrows twice rather
 * than widening — a filter that ORs its terms gets less useful the more you type.
 * The haystack covers what you would search a request list by: method, path,
 * status, and the route it matched.
 */
export function matchesFilter(trace: RequestTrace, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [
    trace.method,
    trace.path,
    String(trace.statusCode),
    trace.route?.pattern ?? "",
    trace.route?.controller ?? "",
    trace.route?.action ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Match a trace against the facet chips.
 *
 * Within one facet the values are alternatives — picking `GET` and `POST` shows
 * both. Across facets they compound, the same way the text terms do: `POST` plus
 * `5xx` means failing writes, not writes-or-failures.
 */
export function matchesFacets(trace: RequestTrace, f: Facets): boolean {
  if (f.methods.length && !f.methods.includes(trace.method.toUpperCase())) return false;
  if (f.statusClasses.length) {
    const cls = String(trace.statusCode || 0).charAt(0);
    if (!f.statusClasses.includes(cls)) return false;
  }
  // A 4xx or 5xx counts as an error even when nothing threw: a rendered 404 is a
  // failed request to anyone reading this list, and the trace only carries an
  // `exception` when an error escaped the pipeline.
  if (f.errors && !trace.exception && trace.statusCode < 400) return false;
  if (f.slow && trace.durationMs <= SLOW_MS) return false;
  if (f.nPlusOne && !trace.warnings.length) return false;
  if (f.kinds?.length && !f.kinds.includes(requestKind(trace))) return false;
  return true;
}

/** Both narrowings at once — what the All tab actually asks. */
export function traceMatches(trace: RequestTrace, query: string, f: Facets): boolean {
  return matchesFacets(trace, f) && matchesFilter(trace, query);
}

/**
 * The method chips worth offering, from the traces actually recorded.
 *
 * Listing every HTTP verb would put five dead chips on screen for an app that
 * only ever GETs. Sorted for a stable strip — chips that reorder as traffic
 * arrives are chips you have to re-find every time you look.
 */
export function methodsPresent(traces: RequestTrace[]): string[] {
  return [...new Set(traces.map((t) => t.method.toUpperCase()))].sort();
}
