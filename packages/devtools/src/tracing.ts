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
 */

import { FrameworkEvents, RequestContext } from "@zerotal/core";
import type { RequestHandled, RequestFailed } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import type {
  QuerySpan,
  NPlusOneWarning,
  LogEntry,
  MailEntry,
  CacheEntry,
  JobEntry,
  RequestTrace,
  TraceChannelDescriptor,
  TraceChannelEntry,
} from "./RequestTrace.ts";
import { traceStore } from "./TraceStore.ts";
import { redactBindings, type RedactionOptions } from "./redaction.ts";

// ── Per-context event buffers ─────────────────────────────────────────────────
// Events are buffered for the full request lifetime (including phases that run
// before DevtoolsInjectionMiddleware, e.g. AuthMiddleware loading the user).
// Buffers are GC'd with the HttpContext via WeakMap.

type _BufLog = { level: LogEntry["level"]; args: string[]; absMs: number };
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

/** Every channel declared so far, in display order. */
export function traceChannels(): TraceChannelDescriptor[] {
  return [...(_channels.values() as Iterable<TraceChannelDescriptor>)].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label),
  );
}

/** @internal — drop every declared channel (provider teardown, tests). */
export function _resetChannels(): void {
  _channels.clear();
}

// ── Redaction ─────────────────────────────────────────────────────────────────

let _redaction: RedactionOptions = {};

/** @internal — set by DevtoolsProvider from the app's `devtools` config. */
export function _setRedaction(options: RedactionOptions): void {
  _redaction = options;
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
  bufferQuery(ctx: object, q: QuerySpan): void;
  bufferWarning(ctx: object, w: NPlusOneWarning): void;
  bufferMail(ctx: object, m: Omit<MailEntry, "offsetMs">): void;
  bufferCache(ctx: object, c: Omit<CacheEntry, "offsetMs">): void;
  bufferJob(ctx: object, j: Omit<JobEntry, "offsetMs">): void;
}

export const traceSink: TraceSink = {
  channel(descriptor: TraceChannelDescriptor): void {
    _channels.set(descriptor.id, descriptor);
  },
  record(ctx: object, channel: string, entry: Record<string, unknown>): void {
    _bufPush(_ctxChannels, ctx, { channel, entry, absMs: Date.now() });
  },
  bufferQuery(ctx: object, q: QuerySpan): void {
    _bufPush(_ctxQueries, ctx, { ...q, bindings: redactBindings(q.sql, q.bindings, _redaction) });
  },
  bufferWarning(ctx: object, w: NPlusOneWarning): void {
    _bufPush(_ctxWarnings, ctx, w);
  },
  bufferMail(ctx: object, m: Omit<MailEntry, "offsetMs">): void {
    _bufPush(_ctxMail, ctx, { ...m, absMs: Date.now() });
  },
  bufferCache(ctx: object, c: Omit<CacheEntry, "offsetMs">): void {
    _bufPush(_ctxCache, ctx, { ...c, absMs: Date.now() });
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

const SAFE_HEADERS = new Set([
  "accept",
  "content-type",
  "user-agent",
  "referer",
  "x-request-id",
  "x-forwarded-for",
  "x-inertia",
  "x-inertia-version",
]);

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

function _buildTrace(ctx: HttpContext, startMs: number, durationMs: number): RequestTrace {
  const queryParams: Record<string, string> = {};
  ctx.url.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });

  const headers: Record<string, string> = {};
  ctx.request.headers.forEach((v, k) => {
    if (SAFE_HEADERS.has(k.toLowerCase())) headers[k] = v;
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
    method: ctx.request.method.toUpperCase(),
    path: ctx.url.pathname,
    statusCode: ctx.response?.status ?? 0,
    startMs,
    durationMs,
    memory: _heapUsed(),
    queryParams,
    headers,
    route: rd ? { pattern: rd.pattern, controller: rd.controller, action: rd.action } : null,
    auth: user ? { id: user["id"], name: user["name"], email: user["email"] } : null,
    queries: _ctxQueries.get(ctx) ?? [],
    warnings: _ctxWarnings.get(ctx) ?? [],
    logs: (_ctxLogs.get(ctx) ?? []).map((l) => ({
      level: l.level,
      args: l.args,
      offsetMs: _offset(l.absMs, startMs),
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
  // code like any other outcome. Everything else on the trace is buffered by
  // feature packages through `traceSink`.
  _unsubs = [
    FrameworkEvents.on<RequestHandled>("RequestHandled", (e) =>
      _finaliseTrace(e.ctx as HttpContext, e.startMs, e.durationMs),
    ),
    FrameworkEvents.on<RequestFailed>("RequestFailed", (e) =>
      _finaliseTrace(e.ctx as HttpContext, e.startMs, e.durationMs),
    ),
  ];
}

/** Merge buffered events into a trace and push it to the store (once per request). */
function _finaliseTrace(ctx: HttpContext, startMs: number, durationMs: number): void {
  // Internal framework paths are noise — skip them
  if (_isInternal(ctx.url.pathname)) {
    _cleanupBuffers(ctx);
    return;
  }

  const trace = _buildTrace(ctx, startMs, durationMs);
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
      _bufPush(_ctxLogs, ctx, {
        level,
        args: args.map((a) =>
          typeof a === "string"
            ? a
            : a instanceof Error
              ? `${a.name}: ${a.message}`
              : (JSON.stringify(a, null, 0) ?? String(a)),
        ),
        absMs: Date.now(),
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
