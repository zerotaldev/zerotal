/**
 * The Inertia DevTools protocol, as types.
 *
 * These names are not ours to choose — they are the wire contract the browser
 * extension reads, so every key here matches the published protocol exactly,
 * including the `__meta` prefix and the `snake`/`camel` inconsistencies. When
 * something looks oddly named, that is why; do not tidy it.
 *
 * @see https://inertiajs.com/docs/v3/advanced/devtools-protocol
 */

/** Request headers the extension sets so entries can be correlated into one timeline. */
export const DEVTOOLS_REQUEST_HEADERS = {
  /** Per-tab UUID; recorded as `__meta.tabUuid`. */
  tab: "X-Inertia-Devtools-Tab",
  /** Client visit id; recorded as `__meta.visitId`. */
  visit: "X-Inertia-Devtools-Visit",
  /** Id of the entry that started this batch; becomes `__meta.batchId`. */
  parent: "X-Inertia-Devtools-Parent",
  /** `"1"` when this request is a deferred-prop follow-up. */
  deferred: "X-Inertia-Devtools-Deferred",
  /** `"1"` when this request is a polling tick. */
  poll: "X-Inertia-Devtools-Poll",
} as const;

/** Response headers the adapter sets so the extension can find the entry it just caused. */
export const DEVTOOLS_RESPONSE_HEADERS = {
  /** The id generated for this entry. Set on every response. */
  id: "X-Inertia-Devtools-Id",
  /** The batch root id, so the extension can chain follow-up requests to their origin. */
  parentOut: "X-Inertia-Devtools-Parent-Out",
} as const;

/** Path prefix of the read API the extension polls. */
export const DEVTOOLS_API_PREFIX = "/_inertia/devtools";

/**
 * How the request reached the adapter. The client-only values (`client-visit`,
 * `cache-hit`) never originate here — they are listed because the extension
 * merges client-recorded entries into the same timeline, and a reader of this
 * type should not think the set is smaller than it is.
 */
export type DevtoolsRequestType =
  | "precognition"
  | "initial"
  | "http"
  | "deferred"
  | "poll"
  | "partial"
  | "prefetch"
  | "navigate"
  | "client-visit"
  | "cache-hit";

/** A source location, where one could be resolved. */
export interface SourceLocation {
  file: string;
  line: number;
}

/**
 * What the adapter knows about one prop, keyed in `Entry.props` by its dotted
 * path. Every field is optional: a plain prop with nothing special about it is
 * recorded as `{}`, which is meaningfully different from being absent.
 */
export interface PropMeta {
  /** Which prop wrapper produced it, if any. */
  inertiaType?: "always" | "defer" | "optional" | "merge" | "scroll" | "once";
  /** True when the prop came from `share()` rather than the controller. */
  shared?: boolean;
  /** The `defer()` group this prop loads with. */
  deferGroup?: string;
  /** True when the client asked for this prop to be reset rather than merged. */
  reset?: boolean;
  /** True for a `once()` prop. */
  once?: boolean;
  /** Which end of the existing value a merge prop is applied to. */
  mergeDirection?: "append" | "prepend";
  /** True when the merge is deep rather than shallow. */
  deepMerge?: boolean;
  /** True when a `defer(..., { rescue: true })` prop threw and was omitted. */
  rescued?: boolean;
  /** Where the prop's value was produced. */
  renderSource?: SourceLocation;
  /** Where a shared prop was registered. */
  shareSource?: SourceLocation;
}

/** Why a body was not captured. */
export type BodyOmittedReason =
  | "non-inertia-response"
  | "non-inertia-request"
  | "non-textual"
  | "streamed"
  | "too-large"
  | "unserializable"
  | "binary";

/**
 * A captured request or response body. A tagged union rather than a nullable
 * value so the panel can say *why* something is missing — "too large" and
 * "there was no body" look identical otherwise.
 */
export type BodyCapture =
  | { status: "empty" }
  | { status: "present"; value: unknown }
  | { status: "omitted"; reason: BodyOmittedReason };

/** The route that matched, as far as the adapter can describe it. */
export interface RouteInfo {
  /** The URL pattern, e.g. `/posts/:slug`. */
  uri: string;
  /** The registered route name, or `null` for an unnamed route. */
  name: string | null;
  /** The controller/handler, e.g. `PostController@show`. */
  action: string | null;
  /** Where the handler is defined, when it can be resolved. */
  actionSource?: SourceLocation;
}

/** Everything the panel shows about one recorded request. */
export interface DevtoolsEntry {
  __meta: {
    id: string;
    method: string;
    url: string;
    status: number;
    requestType: DevtoolsRequestType;
    component: string | null;
    /** ISO 8601. */
    timestamp: string;
    /** Unix time in float seconds. */
    utime: number;
    tabUuid: string | null;
    batchId: string | null;
    serverTimingMs: number | null;
    redirectLocation?: string | null;
    visitId?: string | null;
  };
  http: {
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    requestBody: BodyCapture;
    responseBody: BodyCapture;
  };
  /** Dotted prop path → what is known about it. */
  props: Record<string, PropMeta>;
  /** Dotted prop path → the resolved value, redacted. */
  propValues?: Record<string, unknown>;
  route: RouteInfo;
  renderSource: SourceLocation | null;
  componentPath: string | null;
}

/** Filters accepted by `GET /_inertia/devtools/entries`. */
export interface DevtoolsListQuery {
  /** Exact component-name match. */
  component?: string;
  /** Request types to keep. */
  type?: DevtoolsRequestType[];
  /** Request types to drop; applied after `type`. */
  exclude?: DevtoolsRequestType[];
  offset?: number;
  limit?: number;
}
