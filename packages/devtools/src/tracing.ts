/**
 * Devtools request tracing — event-driven architecture.
 *
 * Subscribes to the core request lifecycle (`RequestHandled` / `RequestFailed`)
 * and, when a request finalises, merges everything buffered against its context
 * into a `RequestTrace` pushed to the trace store (which broadcasts via SSE).
 *
 * Feature packages buffer their own per-request signal through {@link traceSink} —
 * bound in the container as `devtools.trace` and resolved by each package's own
 * devtools bridge when devtools is installed. Devtools therefore imports no
 * feature package.
 *
 * Five signals (queries, N+1, mail, cache, jobs) have dedicated fields and
 * bespoke panels because their UI has earned the special case — a query needs
 * its bindings and a duration bar, mail needs a preview. Everything else arrives
 * through {@link TraceSink.channel} / {@link TraceSink.record}: a package
 * declares how its entries should read and devtools renders them generically, so
 * contributing a tab takes no change in this file.
 *
 * Console patching is handled separately via startConsoleCapture() since
 * console.log is a hook (interception) not a broadcast event.
 *
 * ## This package's cast boundary
 *
 * Listed under `boundaries` in `cast-baseline.json`, so the per-file cast ratchet
 * does not apply here. That is deliberate and confined to this file, for two
 * invariants nothing in the type system can express:
 *
 * 1. **`HttpContext` is read structurally.** `ctx.session`, `ctx.user` and
 *    `ctx._routeDef` are contributed by packages devtools does not import — that
 *    independence is the whole design, and it is why an app without the session
 *    middleware simply has no `session` to read. Every such read is guarded and
 *    falls back to empty; a missing property is the ordinary case, not an error.
 * 2. **`console` is patched by name.** Replacing `console[level]` at runtime is
 *    interception, not a typed call, so the index has to be untyped.
 *
 * Nothing else in `@zerotal/devtools` is exempt. A cast that wants to live
 * somewhere other than this file is a cast to remove.
 */

import { FrameworkEvents, RequestContext } from "@zerotal/core";
import type { RequestHandled, RequestFailed, OutgoingRequestCompleted } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import type {
  QuerySpan,
  NPlusOneWarning,
  LogEntry,
  MailEntry,
  CacheEntry,
  JobEntry,
  ExceptionInfo,
  RequestTrace,
  TraceChannelDescriptor,
  TraceChannelEntry,
} from "./RequestTrace.ts";
import { traceStore } from "./TraceStore.ts";
import { captureCallSite, parseStack } from "./callsite.ts";
import { redactBindings, redactCacheKey, redactValue, type RedactionOptions } from "./redaction.ts";

// ── Per-context event buffers ─────────────────────────────────────────────────
// Events are buffered for the full request lifetime (including phases that run
// before DevtoolsInjectionMiddleware, e.g. AuthMiddleware loading the user).
// Buffers are GC'd with the HttpContext via WeakMap.

type _BufLog = {
  level: LogEntry["level"];
  args: string[];
  absMs: number;
  source?: LogEntry["source"];
};
type _BufMail = Omit<MailEntry, "offsetMs"> & { absMs: number };
type _BufCache = Omit<CacheEntry, "offsetMs"> & { absMs: number };
type _BufJob = Omit<JobEntry, "offsetMs"> & { absMs: number };
type _BufChannel = { channel: string; entry: Record<string, unknown>; absMs: number };

export const _ctxQueries = new WeakMap<object, QuerySpan[]>();
export const _ctxWarnings = new WeakMap<object, NPlusOneWarning[]>();
export const _ctxLogs = new WeakMap<object, _BufLog[]>();
export const _ctxMail = new WeakMap<object, _BufMail[]>();
export const _ctxCache = new WeakMap<object, _BufCache[]>();
export const _ctxJobs = new WeakMap<object, _BufJob[]>();
export const _ctxChannels = new WeakMap<object, _BufChannel[]>();

export function _bufPush<T>(map: WeakMap<object, T[]>, ctx: object, item: T): void {
  let arr = map.get(ctx);
  if (!arr) {
    arr = [];
    map.set(ctx, arr);
  }
  arr.push(item);
}

// ── Channel registry ──────────────────────────────────────────────────────────

const _channels = new Map<string, TraceChannelDescriptor>();

/**
 * Every channel that wants a tab, in display order.
 *
 * A `hidden` channel is left out: its entries are still recorded and still reach
 * the panel on the trace, but whatever renders them is not this generic row list.
 */
export function traceChannels(): TraceChannelDescriptor[] {
  return [...(_channels.values() as Iterable<TraceChannelDescriptor>)]
    .filter((c) => !c.hidden)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));
}

/** @internal — drop every declared channel (provider teardown, tests). */
export function _resetChannels(): void {
  _channels.clear();
}

// ── Capture settings ──────────────────────────────────────────────────────────

let _redaction: RedactionOptions = {};

/** @internal — set by DevtoolsProvider from the app's `devtools` config. */
export function _setRedaction(options: RedactionOptions): void {
  _redaction = options;
}

/**
 * Whether to walk the stack for each query and log line.
 *
 * A field rather than a config read per event: this runs on the hot path of a
 * request running forty queries, and resolving config forty times to answer the
 * same question would cost more than the walk it is guarding.
 */
let _captureSource = true;

/** @internal — set by DevtoolsProvider from the app's `devtools` config. */
export function _setCaptureSource(enabled: boolean): void {
  _captureSource = enabled;
}

/**
 * Request headers recorded beyond the built-in safe list, lower-cased.
 * `"*"` records every header the redaction rules do not mask.
 */
let _extraHeaders = new Set<string>();

/** @internal — set by DevtoolsProvider from the app's `devtools` config. */
export function _setHeaderAllowlist(headers: string[]): void {
  _extraHeaders = new Set(headers.map((h) => h.toLowerCase()));
}

// ── The sink feature packages contribute to ───────────────────────────────────

/**
 * The buffer surface feature packages contribute to, bound in the container as
 * `devtools.trace`.
 *
 * Each method buffers one entry against the request context it ran under; the
 * request-finalise handler merges them into the trace and stamps each entry's
 * offset from the request start.
 */
export interface TraceSink {
  /**
   * Declare a channel so its entries get a tab. Idempotent — a package can call
   * this on every boot. A later declaration replaces an earlier one with the
   * same id, so a package can refine its display without a restart.
   */
  channel(descriptor: TraceChannelDescriptor): void;
  /**
   * Record one entry on a channel. `offsetMs` is stamped for you.
   *
   * Unknown channel ids are still recorded — a channel declared after the fact
   * picks up the entries already buffered for the request in flight.
   */
  record(ctx: object, channel: string, entry: Record<string, unknown>): void;
  /**
   * Turn a context into a trace, for work that never was an HTTP request.
   *
   * Traces are normally finalised from core's `RequestHandled` / `RequestFailed`,
   * which covers everything the HTTP kernel serves and nothing else. A Flow action
   * arrives over a WebSocket and runs against its own `HttpContext` — as do queue
   * jobs and scheduled tasks — so no HTTP lifecycle event ever fires for it, and
   * without this call everything buffered against that context (its channel rows,
   * but equally its queries, its logs, its N+1 warnings) accumulated and was
   * dropped unread. The Flow tab could then only ever report "no flow activity",
   * which is exactly what it did.
   *
   * `method` labels the trace in the request list, because the underlying request
   * is synthetic: Flow passes `FLOW` so an action is not read as a second `GET` of
   * the page it acted on.
   *
   * Finalising happens once per context; a second call for the same one is ignored.
   */
  finalise(ctx: object, meta: { startMs: number; durationMs: number; method?: string }): void;
  bufferQuery(ctx: object, q: QuerySpan): void;
  bufferWarning(ctx: object, w: NPlusOneWarning): void;
  bufferMail(ctx: object, m: Omit<MailEntry, "offsetMs">): void;
  bufferCache(ctx: object, c: Omit<CacheEntry, "offsetMs">): void;
  bufferJob(ctx: object, j: Omit<JobEntry, "offsetMs">): void;
}

// Everything below masks on the way *in*. Redacting in a renderer would protect
// nothing: by the time a panel draws a row, the unredacted copy has already been
// streamed to the browser and written to `.zerotal/devtools.sqlite`, where it
// sits for a day. The sink is the last point where "not recorded" is still true.
export const traceSink: TraceSink = {
  channel(descriptor: TraceChannelDescriptor): void {
    _channels.set(descriptor.id, descriptor);
  },
  record(ctx: object, channel: string, entry: Record<string, unknown>): void {
    _bufPush(_ctxChannels, ctx, {
      channel,
      entry: redactValue(entry, _redaction) as Record<string, unknown>,
      absMs: Date.now(),
    });
  },
  finalise(ctx: object, meta: { startMs: number; durationMs: number; method?: string }): void {
    _finaliseTrace(ctx as HttpContext, meta.startMs, meta.durationMs, null, meta.method);
  },
  bufferQuery(ctx: object, q: QuerySpan): void {
    // The call site is captured here rather than at the emit site because here
    // is the only place that knows whether anyone is recording. `skip` is 0: the
    // frames above are this method and the ORM's bridge, both of which the
    // framework filter drops anyway.
    const source = _captureSource && !q.source ? captureCallSite() : q.source;
    _bufPush(_ctxQueries, ctx, {
      ...q,
      bindings: redactBindings(q.sql, q.bindings, _redaction),
      ...(source ? { source } : {}),
    });
  },
  bufferWarning(ctx: object, w: NPlusOneWarning): void {
    _bufPush(_ctxWarnings, ctx, w);
  },
  bufferMail(ctx: object, m: Omit<MailEntry, "offsetMs">): void {
    _bufPush(_ctxMail, ctx, { ...m, absMs: Date.now() });
  },
  bufferCache(ctx: object, c: Omit<CacheEntry, "offsetMs">): void {
    _bufPush(_ctxCache, ctx, { ...c, key: redactCacheKey(c.key, _redaction), absMs: Date.now() });
  },
  bufferJob(ctx: object, j: Omit<JobEntry, "offsetMs">): void {
    _bufPush(_ctxJobs, ctx, { ...j, absMs: Date.now() });
  },
};

function _cleanupBuffers(ctx: object): void {
  _ctxQueries.delete(ctx);
  _ctxWarnings.delete(ctx);
  _ctxLogs.delete(ctx);
  _ctxMail.delete(ctx);
  _ctxCache.delete(ctx);
  _ctxJobs.delete(ctx);
  _ctxChannels.delete(ctx);
}

// ── Trace builder ─────────────────────────────────────────────────────────────

/**
 * Request headers recorded without being asked.
 *
 * An allowlist rather than a denylist because a trace is *persisted*: `cookie`
 * and `authorization` are the request's credentials, and a header nobody thought
 * to deny is a header on disk for a day. The cost is that the custom header you
 * are actually debugging is invisible, which is what `devtools.headers` opens.
 */
const SAFE_HEADERS = new Set([
  "accept",
  // What the browser wanted the response for — `document`, `image`, `style`.
  // The only unfoolable way to tell a page from a file the page pulled in, and
  // devtools classifies every trace by it.
  "sec-fetch-dest",
  "sec-fetch-mode",
  "content-type",
  "content-length",
  "user-agent",
  "referer",
  "origin",
  "accept-language",
  "x-request-id",
  "x-forwarded-for",
  "x-inertia",
  "x-inertia-version",
  "x-requested-with",
]);

/** Never recorded, whatever the allowlist says — these *are* the credentials. */
const NEVER_HEADERS = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization"]);

function _recordHeader(name: string): boolean {
  const key = name.toLowerCase();
  if (NEVER_HEADERS.has(key)) return false;
  return SAFE_HEADERS.has(key) || _extraHeaders.has("*") || _extraHeaders.has(key);
}

const INTERNAL_PREFIXES = ["/__flow/", "/__zerotal/", "/__dev/"];

function _isInternal(path: string): boolean {
  return INTERNAL_PREFIXES.some((p) => path.startsWith(p));
}

/** Heap in use as the request finishes — what the panel's Memory stat reports. */
function _heapUsed(): number {
  try {
    return process.memoryUsage().heapUsed;
  } catch {
    return 0;
  }
}

/** Stamp an offset from the request start onto a buffered entry. */
function _offset(absMs: number, startMs: number): number {
  return Math.max(0, absMs - startMs);
}

/**
 * What is in the session — the key names, never the values.
 *
 * "Is the CSRF token there, did the flash survive the redirect, is the user id
 * set" are the session questions a request inspector is asked, and all three are
 * answered by the keys. The values are the request's real state — the user's id,
 * the token itself, whatever a form flashed — and this trace is written to disk
 * for a day.
 *
 * Read structurally: devtools imports no feature package, and an app without the
 * session middleware has no `ctx.session` at all.
 */
function _sessionKeys(ctx: HttpContext): string[] {
  try {
    const session = (ctx as unknown as Record<string, unknown>)["session"] as
      { _data?: Record<string, unknown> } | undefined;
    return session?._data ? Object.keys(session._data).sort() : [];
  } catch {
    return [];
  }
}

function _buildTrace(
  ctx: HttpContext,
  startMs: number,
  durationMs: number,
  exception: ExceptionInfo | null,
  method?: string,
): RequestTrace {
  const queryParams: Record<string, string> = {};
  ctx.url.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });

  const headers: Record<string, string> = {};
  ctx.request.headers.forEach((v, k) => {
    if (_recordHeader(k)) headers[k] = v;
  });

  // The response half of the exchange: its status line and the headers it set.
  // A request tab that shows only what came in answers half the question.
  const responseHeaders: Record<string, string> = {};
  ctx.response?.headers.forEach((v, k) => {
    if (_recordHeader(k)) responseHeaders[k] = v;
  });

  const ctxRecord = ctx as unknown as Record<string, unknown>;
  const rd = ctxRecord["_routeDef"] as
    { pattern: string; controller: string; action: string } | undefined;

  const user = ctxRecord["user"] as Record<string, unknown> | undefined;

  const channels: Record<string, TraceChannelEntry[]> = {};
  for (const { channel, entry, absMs } of _ctxChannels.get(ctx) ?? []) {
    (channels[channel] ??= []).push({ ...entry, offsetMs: _offset(absMs, startMs) });
  }

  return {
    id: crypto.randomUUID().slice(0, 12),
    requestId: ctx.requestId,
    method: (method ?? ctx.request.method).toUpperCase(),
    path: ctx.url.pathname,
    statusCode: ctx.response?.status ?? 0,
    startMs,
    durationMs,
    memory: _heapUsed(),
    queryParams,
    headers,
    responseHeaders,
    session: _sessionKeys(ctx),
    route: rd ? { pattern: rd.pattern, controller: rd.controller, action: rd.action } : null,
    auth: user ? { id: user["id"], name: user["name"], email: user["email"] } : null,
    exception,
    queries: _ctxQueries.get(ctx) ?? [],
    warnings: _ctxWarnings.get(ctx) ?? [],
    logs: (_ctxLogs.get(ctx) ?? []).map((l) => ({
      level: l.level,
      args: l.args,
      offsetMs: _offset(l.absMs, startMs),
      ...(l.source ? { source: l.source } : {}),
    })),
    mail: (_ctxMail.get(ctx) ?? []).map(({ absMs, ...rest }) => ({
      ...rest,
      offsetMs: _offset(absMs, startMs),
    })),
    cache: (_ctxCache.get(ctx) ?? []).map(({ absMs, ...rest }) => ({
      ...rest,
      offsetMs: _offset(absMs, startMs),
    })),
    jobs: (_ctxJobs.get(ctx) ?? []).map(({ absMs, ...rest }) => ({
      ...rest,
      offsetMs: _offset(absMs, startMs),
    })),
    channels,
  };
}

// ── FrameworkEvents subscriptions ─────────────────────────────────────────────

let _unsubs: Array<() => void> = [];

/** @internal — subscribe to all framework events; called by DevtoolsProvider.onBooted() */
export function startDevtoolsTracing(): void {
  // Idempotent on purpose. Assigning `_unsubs` used to drop the handles to any
  // existing subscription without unsubscribing it, so a second call left the
  // first listener live and unreachable — and `_finaliseTrace` then ran once per
  // live listener, recording every request as many times as start() was called.
  stopDevtoolsTracing();

  // Both successful and failed requests finalise the trace. Failed requests still
  // carry the rendered error response on ctx, so the trace records the error status
  // code like any other outcome — and now the message with it, which used to be
  // dropped here, leaving a red 500 in the panel with nothing to read next to it.
  // Everything else on the trace is buffered by feature packages through `traceSink`.
  _unsubs = [
    FrameworkEvents.on<RequestHandled>("RequestHandled", (e) =>
      _finaliseTrace(e.ctx as HttpContext, e.startMs, e.durationMs, null),
    ),
    FrameworkEvents.on<RequestFailed>("RequestFailed", (e) => {
      const frames = parseStack(e.stack);
      _finaliseTrace(e.ctx as HttpContext, e.startMs, e.durationMs, {
        message: e.error,
        status: e.status,
        ...(e.type ? { type: e.type } : {}),
        ...(frames.length ? { frames } : {}),
      });
    }),
    // Outgoing calls, recorded here rather than by a bridge in the package that
    // owns them: the owner is `@zerotal/core`, and core cannot know about the
    // channel API because devtools is what depends on core. Devtools already
    // subscribes to core's events, so this costs no new dependency in either
    // direction.
    FrameworkEvents.on<OutgoingRequestCompleted>("OutgoingRequestCompleted", (e) => {
      // The event carries no context — the client does not take one — so the
      // request is read from the ambient scope it was called in.
      const ctx = RequestContext.tryGet();
      if (!ctx) return;
      traceSink.record(ctx, "http", {
        method: e.method,
        url: e.url,
        host: e.host,
        status: e.status || "—",
        durationMs: e.durationMs,
        failed: !e.ok,
      });
    }),
  ];

  // Declared here rather than in a satellite for the same reason. `order` puts
  // it beside the other per-request feeds rather than at the back of the strip.
  traceSink.channel({
    id: "http",
    label: "Outgoing",
    badge: "method",
    title: "url",
    meta: ["status", "durationMs", "host"],
    warn: "failed",
    order: 35,
    render: "table",
  });
}

/**
 * Contexts already turned into a trace.
 *
 * One trace per context, enforced here rather than trusted: the HTTP lifecycle
 * finalises exactly once, but a context that finalises *itself* — a Flow action,
 * a queue job — could also be claimed by something else, and the second call
 * would push a duplicate carrying none of the evidence, since the first cleaned
 * the buffers out. Weak so it holds no context alive.
 */
const _finalised = new WeakSet<object>();

/** Merge buffered events into a trace and push it to the store (once per request). */
function _finaliseTrace(
  ctx: HttpContext,
  startMs: number,
  durationMs: number,
  exception: ExceptionInfo | null,
  method?: string,
): void {
  if (_finalised.has(ctx)) return;
  _finalised.add(ctx);

  // Internal framework paths are noise — skip them
  if (_isInternal(ctx.url.pathname)) {
    _cleanupBuffers(ctx);
    return;
  }

  const trace = _buildTrace(ctx, startMs, durationMs, exception, method);
  _cleanupBuffers(ctx);
  traceStore().push(trace);
}

/** @internal — unsubscribe; called by DevtoolsProvider.onStopping() */
export function stopDevtoolsTracing(): void {
  for (const unsub of _unsubs) unsub();
  _unsubs = [];
}

// ── Console capture ───────────────────────────────────────────────────────────

const LOG_LEVELS = ["log", "debug", "info", "warn", "error"] as const;
let _origConsole: Partial<Record<string, unknown>> = {};
let _consoleCaptured = false;

/**
 * One logged argument, as the line the panel shows.
 *
 * Objects are redacted before they are serialised, not after: `console.log(user)`
 * during a debug session used to write the whole record — password hash included
 * — to disk for a day. Redacting also makes the value safe to serialise at all,
 * since the walk replaces cycles; a circular argument used to throw a
 * `Converting circular structure to JSON` out of this patch and into the caller's
 * `console.log`.
 */
function _formatLogArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  const safe = redactValue(value, _redaction);
  try {
    return JSON.stringify(safe) ?? String(safe);
  } catch {
    // BigInt, a throwing toJSON — the log line is not worth failing the request.
    return String(safe);
  }
}

/** @internal — patch console.* to capture log lines per request context */
export function startConsoleCapture(): void {
  // Idempotent: a second start() without an intervening stop() would otherwise
  // wrap the wrapper and capture already-patched methods as "originals".
  if (_consoleCaptured) return;
  _consoleCaptured = true;
  for (const level of LOG_LEVELS) {
    // Capture the original in a closure-local so the wrapper never depends on
    // mutable module state. If a wrapper is left installed after stop() clears
    // _origConsole (e.g. multiple app lifecycles share one process), it still
    // forwards to the real console instead of dereferencing undefined.
    const orig = (console as unknown as Record<string, (...a: unknown[]) => void>)[level] as (
      ...a: unknown[]
    ) => void;
    _origConsole[level] = orig;
    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = function (
      ...args: unknown[]
    ) {
      orig(...args);
      const ctx = RequestContext.tryGet();
      if (!ctx) return;
      // One frame to skip: this wrapper is standing between the caller and the
      // stack, and without dropping it every log line would point at devtools.
      const source = _captureSource ? captureCallSite(1) : null;
      _bufPush(_ctxLogs, ctx, {
        level,
        args: args.map(_formatLogArg),
        absMs: Date.now(),
        ...(source ? { source } : {}),
      });
    };
  }
}

/** @internal — restore original console methods */
export function stopConsoleCapture(): void {
  if (!_consoleCaptured) return;
  for (const level of LOG_LEVELS) {
    if (_origConsole[level]) {
      (console as unknown as Record<string, unknown>)[level] = _origConsole[level];
    }
  }
  _origConsole = {};
  _consoleCaptured = false;
}
