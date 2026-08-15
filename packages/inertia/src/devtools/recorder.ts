/**
 * The recorder: turns one request/response pair into one {@link DevtoolsEntry}.
 *
 * Recording is split across the request because the data is. The middleware
 * knows the method, URL, timing and status; only `buildPageObject` knows the
 * component and which prop wrapper produced which key, and it runs in the
 * middle. So the middleware opens a recording, the page builder enriches it
 * while it has the props in hand, and the middleware closes and stores it.
 *
 * The in-flight recording is parked on the `HttpContext`, not in a module
 * variable: concurrent requests share this process, and a module-level "current
 * entry" would attribute one request's props to another's response under any
 * real load.
 */
import { RequestContext, Router, config } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import {
  AlwaysProp,
  DeferProp,
  InertiaProp,
  InfiniteScrollProp,
  MergeProp,
  OptionalProp,
} from "../props/PropTypes.ts";
import { allSharedKeys } from "../share.ts";
import {
  DEFAULT_REDACTED_HEADERS,
  DEFAULT_REDACTED_KEYS,
  redactHeaders,
  redactValue,
} from "./redact.ts";
import { putEntry } from "./store.ts";
import { DEVTOOLS_REQUEST_HEADERS, type BodyCapture } from "./types.ts";
import type { DevtoolsEntry, DevtoolsRequestType, PropMeta } from "./types.ts";
import { devtoolsSettings } from "./enabled.ts";

/** Key under which the in-flight recording is parked on the HttpContext. */
const RECORDING_KEY = "inertia:devtools:recording";

/** The mutable half of an entry, filled in as the request proceeds. */
interface Recording {
  id: string;
  startedAt: number;
  timestamp: string;
  utime: number;
  component: string | null;
  props: Record<string, PropMeta>;
  propValues: Record<string, unknown>;
}

/**
 * A collision-resistant id. `crypto.randomUUID()` rather than a ULID: the
 * protocol asks only for collision resistance, and this needs no dependency.
 */
function newId(): string {
  return crypto.randomUUID();
}

/** Classify the request from the headers the client sent. */
function requestTypeOf(request: Request, headers: Headers): DevtoolsRequestType {
  if (headers.get(DEVTOOLS_REQUEST_HEADERS.deferred) === "1") return "deferred";
  if (headers.get(DEVTOOLS_REQUEST_HEADERS.poll) === "1") return "poll";
  if (headers.get("X-Inertia-Precognition") === "true") return "precognition";
  if (headers.get("X-Inertia-Prefetch") === "true") return "prefetch";
  if (headers.get("X-Inertia-Partial-Component")) return "partial";
  // No `X-Inertia` at all means the browser asked for the document itself —
  // the first load, before the client adapter exists to set the header.
  if (headers.get("X-Inertia") !== "true") return "initial";
  return request.method === "GET" ? "navigate" : "http";
}

/** Begin recording. Returns the entry id, which the caller sets as a response header. */
export function beginRecording(http: HttpContext): string {
  const now = Date.now();
  const recording: Recording = {
    id: newId(),
    startedAt: performance.now(),
    timestamp: new Date(now).toISOString(),
    utime: now / 1000,
    component: null,
    props: {},
    propValues: {},
  };
  http.setInternal(RECORDING_KEY, recording);
  return recording.id;
}

/** The in-flight recording for this request, if one was opened. */
function currentRecording(): Recording | undefined {
  return RequestContext.tryGet()?.getInternal<Recording>(RECORDING_KEY);
}

/**
 * Describe one prop from the wrapper that produced it.
 *
 * Mirrors the branches in `resolveProps`; a prop the resolver treats specially
 * and this does not would show up in the panel as an ordinary prop, which is
 * the kind of quiet wrongness a debugging tool must not have.
 */
function describeProp(value: unknown, key: string, shared: Set<string>): PropMeta {
  const meta: PropMeta = {};
  if (shared.has(key)) meta.shared = true;

  if (!(value instanceof InertiaProp)) return meta;

  if (value instanceof AlwaysProp) meta.inertiaType = "always";
  else if (value instanceof DeferProp) {
    meta.inertiaType = "defer";
    meta.deferGroup = value.group;
  } else if (value instanceof InfiniteScrollProp) meta.inertiaType = "scroll";
  else if (value instanceof MergeProp) meta.inertiaType = "merge";
  else if (value instanceof OptionalProp) meta.inertiaType = "optional";

  if (value.isOnce) {
    // `once` is a modifier, not a wrapper — a prop can be both `merge()` and
    // `once()`. Recorded as the flag so the wrapper's own type survives, and
    // only claimed as the *type* when nothing else did.
    meta.once = true;
    meta.inertiaType ??= "once";
  }

  if (value.shouldMerge) {
    const cfg = value.mergeConfig();
    if (cfg.deep) meta.deepMerge = true;
    meta.mergeDirection = cfg.prependRoot || cfg.prependPaths.length > 0 ? "prepend" : "append";
  }

  return meta;
}

/**
 * Attach the component and prop metadata to the in-flight recording.
 *
 * Called from `buildPageObject`, which is the only place that sees the raw prop
 * wrappers *and* the resolved values. A no-op when nothing is recording, so the
 * call site needs no guard of its own.
 *
 * @param component - The page component name.
 * @param raw - The unresolved prop map (shared + controller), wrappers intact.
 * @param resolved - The resolved values actually sent to the client.
 * @param rescued - Keys reported in `rescuedProps`.
 */
export function recordPage(
  component: string,
  raw: Record<string, unknown>,
  resolved: Record<string, unknown>,
  rescued: readonly string[] = [],
): void {
  const recording = currentRecording();
  if (!recording) return;

  const settings = devtoolsSettings();
  const keyPatterns = [...DEFAULT_REDACTED_KEYS, ...settings.redact];
  const shared = new Set(allSharedKeys());
  const rescuedSet = new Set(rescued);

  recording.component = component;

  for (const [key, value] of Object.entries(raw)) {
    const meta = describeProp(value, key, shared);
    if (rescuedSet.has(key)) meta.rescued = true;
    recording.props[key] = meta;
  }

  for (const [key, value] of Object.entries(resolved)) {
    recording.propValues[key] = redactValue(value, keyPatterns);
  }
}

/** Look up the matched route by path, for the entry's `route` block. */
function routeInfoFor(http: HttpContext): DevtoolsEntry["route"] {
  const pathname = http.url.pathname;

  // `namedRoutes` is name → pattern; the panel wants the reverse. Prefer an
  // exact pattern match, then the first pattern whose params fit — a named
  // route is more useful in the panel than a bare URI, and the lookup happens
  // once per recorded request.
  let name: string | null = null;
  let uri = pathname;
  for (const [routeName, pattern] of Router.namedRoutes) {
    if (pattern === pathname) {
      name = routeName;
      uri = pattern;
      break;
    }
    const regex = new RegExp(
      `^${pattern.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, "[^/]+").replace(/\*/g, ".*")}$`,
    );
    if (name === null && regex.test(pathname)) {
      name = routeName;
      uri = pattern;
    }
  }

  return { uri, name, action: null };
}

/** Capture a response body, refusing anything that should not be inlined. */
function captureResponseBody(response: Response, isInertia: boolean): BodyCapture {
  if (!isInertia) return { status: "omitted", reason: "non-inertia-response" };

  const type = response.headers.get("Content-Type") ?? "";
  if (type.startsWith("text/event-stream")) return { status: "omitted", reason: "streamed" };
  if (!type.includes("json")) return { status: "omitted", reason: "non-textual" };

  // The body is not read here: consuming the stream would empty it before the
  // client got it, and cloning a response on every request costs more than the
  // panel gains. The page object is already recorded field-by-field in `props`
  // and `propValues`, which is the part anyone actually reads.
  return { status: "empty" };
}

/**
 * Close the recording and store it.
 *
 * @param http - The request context the recording was opened on.
 * @param response - The response about to be returned.
 * @param parentOut - The batch root id, echoed into `__meta.batchId`.
 */
export function finishRecording(
  http: HttpContext,
  response: Response,
  parentOut: string | null,
): void {
  const recording = currentRecording();
  if (!recording) return;

  const settings = devtoolsSettings();
  const headerPatterns = [...DEFAULT_REDACTED_HEADERS, ...settings.redactHeaders];
  const requestHeaders = http.request.headers;
  const isInertia =
    requestHeaders.get("X-Inertia") === "true" ||
    (response.headers.get("Content-Type") ?? "").includes("json");

  const entry: DevtoolsEntry = {
    __meta: {
      id: recording.id,
      method: http.request.method,
      url: http.url.href,
      status: response.status,
      requestType: requestTypeOf(http.request, requestHeaders),
      component: recording.component,
      timestamp: recording.timestamp,
      utime: recording.utime,
      tabUuid: requestHeaders.get(DEVTOOLS_REQUEST_HEADERS.tab),
      batchId: parentOut,
      serverTimingMs: Math.round((performance.now() - recording.startedAt) * 1000) / 1000,
      redirectLocation: response.headers.get("Location"),
      visitId: requestHeaders.get(DEVTOOLS_REQUEST_HEADERS.visit),
    },
    http: {
      requestHeaders: redactHeaders(requestHeaders, headerPatterns),
      responseHeaders: redactHeaders(response.headers, headerPatterns),
      // Same reasoning as the response body: reading the request stream here
      // would consume it, and by this point the handler has already had it.
      requestBody: { status: "omitted", reason: "non-inertia-request" },
      responseBody: captureResponseBody(response, isInertia),
    },
    props: recording.props,
    route: routeInfoFor(http),
    renderSource: null,
    componentPath: recording.component
      ? `${config.safe("inertia.pagesDir", "resources/js/pages")}/${recording.component}`
      : null,
  };

  if (Object.keys(recording.propValues).length > 0) entry.propValues = recording.propValues;

  putEntry(entry);
}
