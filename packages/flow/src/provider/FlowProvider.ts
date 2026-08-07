import { fileURLToPath } from "node:url";
import {
  ServiceProvider,
  type Application,
  Router,
  HttpContext,
  RequestContext,
  Pipeline,
  registerFileRouteResolver,
  FrameworkEvents,
  config,
} from "@zerotal/core";
import {
  WebSocketConnected,
  WebSocketDisconnected,
  FlowActionHandled,
} from "../frameworkEvents.ts";
import { installFlowObservability } from "../observability.ts";
import { DEFAULT_PERSISTENT_MIDDLEWARE } from "../config.ts";
import type { AppEnvironment, Container, MiddlewareClass, NextFn } from "@zerotal/core";
import type { WebSocketHandlers } from "@zerotal/core";
import type { CallFrame, Snapshot } from "../types.ts";
import { getPage, getAllowedMethods, getRenderlessMethods, BUILTIN_ACTIONS } from "../registry.ts";
import {
  hydrate,
  dehydrate,
  encodeSnapshotDelta,
  FlowIntegrityError,
  FlowSnapshotOwnershipError,
  warnIfLarge,
  type SnapshotDelta,
} from "../dehydrate.ts";
import { _renderFlowPage } from "../jsx-runtime.ts";
import { populatePresence } from "../presence.ts";
import { populateShared, snapshotSharedValues, commitShared } from "../shared.ts";
import { persistDurable } from "../durable.ts";
import type { Component } from "../Component.ts";
import { flowRoute, registerFlowFileRoute, _persistSessionProps } from "../router.ts";
import type { PageClassWithMeta } from "../registry.ts";
import { getTaskMethods } from "../decorators.ts";
import { ValidationError } from "../validation.ts";
import { makeSignedRef } from "../uploads/TemporaryUploadedFile.ts";
import { isAllowedOrigin } from "@zerotal/core/http";

// ── In-memory runtime.js bundle (built once at boot) ─────────────────────────

/** True when this process is the `serve --dev-worker` (dev fast refresh gates on it). */
const _isDevWorker = Bun.argv.includes("--dev-worker");

// ── Running @task registry (for cancellation) ─────────────────────────────────
// componentId → the AbortController of its currently-running @task, plus the connection
// that started it. A `$cancel` frame (sent out-of-band by the client, bypassing the
// per-component send queue) aborts it; the task observes `this.signal` / `this.cancelled`
// and stops cooperatively.
//
// The owning socket is recorded because `$cancel` runs before component lookup, before
// hydrate() — the only HMAC check — and before rate limiting, and this map is
// process-global keyed only by component id. Without the owner check, any connected user
// could kill any other user's running task given its 32-bit id, which leaks in screenshots
// and bug reports.
interface RunningTask {
  controller: AbortController;
  owner: FlowBunWs;
}
const _runningTasks = new Map<string, RunningTask>();

/** How often (ms) a running @task flushes a throttled streaming patch of its changed state. */
const TASK_FLUSH_MS = 80;

/** Dev-only error detail carried on the error frame so the client can render the error overlay. */
interface DevErrorInfo {
  name: string;
  message: string;
  stack?: string | undefined;
  action: string;
}

/** Extract overlay-ready detail from a thrown value. @internal (exported for tests). */
export function _devErrorInfo(error: unknown, action: string): DevErrorInfo {
  const e = error instanceof Error ? error : new Error(String(error));
  return { name: e.name || "Error", message: e.message, stack: e.stack, action };
}

let _runtimeBundle: string | null = null;

/**
 * CSP-safe mode flag (no 'unsafe-eval'). Set `flow.cspSafe` in `config/flow.ts`,
 * or the ZT_FLOW_CSP_SAFE / APP_CSP_SAFE env flag when there is no config file.
 */
function _isCspSafe(): boolean {
  const fromEnv = Bun.env["ZT_FLOW_CSP_SAFE"] ?? Bun.env["APP_CSP_SAFE"];
  return config.safe("flow.cspSafe", fromEnv === "true" || fromEnv === "1");
}

/** @internal — read by router.ts to build <script> tags. */
export function _runtimeJs(): string | null {
  return _runtimeBundle;
}

// ── Rate limiter for HMAC failures (Livewire pattern) ─────────────────────────

const _checksumFailures = new Map<string, { count: number; since: number }>();
const CHECKSUM_MAX = 10;
const CHECKSUM_WINDOW_MS = 600_000; // 10 minutes

// Periodic sweep so the map doesn't grow unbounded under IP rotation.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _checksumFailures) {
    if (now - entry.since > CHECKSUM_WINDOW_MS) _checksumFailures.delete(ip);
  }
}, CHECKSUM_WINDOW_MS).unref?.();

/** Returns false when this IP has exceeded the failure threshold. */
function _isChecksumRateLimited(ip: string): boolean {
  const entry = _checksumFailures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > CHECKSUM_WINDOW_MS) {
    _checksumFailures.delete(ip);
    return false;
  }
  return entry.count >= CHECKSUM_MAX;
}

/** Called only when a checksum actually fails — not on every request. */
function _recordChecksumFailure(ip: string): void {
  const now = Date.now();
  const entry = _checksumFailures.get(ip);
  if (!entry || now - entry.since > CHECKSUM_WINDOW_MS) {
    _checksumFailures.set(ip, { count: 1, since: now });
  } else {
    entry.count++;
  }
}

// ── Session relay store ───────────────────────────────────────────────────────
// When a Flow action mutates the session (login/logout) and then redirects,
// the session cookie cannot be set directly over WebSocket. Instead we store
// the serialised Set-Cookie header under a short-lived one-time token and send
// the token to the client. The client fetches /__flow/session-relay?t=<token>
// (a regular HTTP request), the browser receives the Set-Cookie header and
// stores the cookie, then the redirect to the intended page proceeds.
//
// Tokens expire after 30 s; a sweep runs every 60 s to prune stale entries.

interface _RelayEntry {
  setCookie: string;
  expiresAt: number;
}
const _sessionRelayStore = new Map<string, _RelayEntry>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _sessionRelayStore) if (v.expiresAt < now) _sessionRelayStore.delete(k);
}, 60_000).unref?.();

// ── Temporary upload garbage collection ───────────────────────────────────────
// Files uploaded to /__flow/upload land on the temp disk under flow-tmp/. We track
// each one and delete it after a TTL so abandoned uploads don't accumulate. (Promoting a
// file to permanent storage via TemporaryUploadedFile.store() removes the temp copy itself.)

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB ceiling (apps can validate stricter)
const TEMP_UPLOAD_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const _tempUploads = new Map<string, number>(); // tmpPath → expiresAt
setInterval(() => {
  const now = Date.now();
  for (const [path, exp] of _tempUploads) {
    if (exp >= now) continue;
    _tempUploads.delete(path);
    void (async () => {
      try {
        const { Storage } = (await import("@zerotal/core/storage")) as {
          Storage: { disk(): { delete(p: string): Promise<void> } };
        };
        await Storage.disk().delete(path);
      } catch {
        /* best-effort sweep */
      }
    })();
  }
}, 30 * 60_000).unref?.();

// ── WS message handler ────────────────────────────────────────────────────────

type FlowBunWs = {
  data: {
    flowUrl?: string;
    remoteIp?: string;
    /** Origin of the upgrade request — used to build the synthetic request URL. */
    origin?: string;
    /** Headers captured at WS upgrade (cookies, authorization, …) — replayed on every frame. */
    headers?: Headers;
    /** Per-connection id assigned on open — keys the connected-clients registry. */
    connId?: string;
    /**
     * HTML suppression cache: componentId → Bun.hash of the last `html` sent on this
     * connection. When the next render hashes the same, `html` is omitted from the patch
     * (the client keeps its DOM). Per-connection, so it is GC'd on disconnect, and WS
     * stickiness guarantees a component's actions all reach this same map.
     */
    flowHtmlHashes?: Map<string, string>;
  };
  send(msg: string): void;
};

/** Dependencies handed to the WS message handler by FlowProvider.onBooting(). */
type FlowWsDeps = {
  container: Container;
  globalMiddleware: () => MiddlewareClass[];
};

async function _handleFlowMessage(ws: FlowBunWs, raw: string, deps: FlowWsDeps): Promise<void> {
  let frame: CallFrame;
  try {
    frame = JSON.parse(raw) as CallFrame;
  } catch {
    return;
  }

  if (frame.type !== "call") return;

  // `$cancel` is handled out-of-band, before hydrate/dispatch: the client sends it while a
  // @task is mid-flight (the per-component queue is still blocked on that task), so it can't
  // go through the normal action path. Abort the running task's controller and return; the
  // task observes the abort and finishes, sending its own final patch.
  if (frame.method === "$cancel") {
    const running = _runningTasks.get(frame.component);
    // Only the connection that started the task may cancel it. Component ids are short and
    // routinely visible, so ownership has to come from the socket, not from the frame.
    if (running && running.owner === ws) running.controller.abort();
    return;
  }

  const ip = ws.data.remoteIp ?? "unknown";
  const entry = getPage(frame.snapshot.memo.name);

  if (!entry) {
    ws.send(
      JSON.stringify({ type: "error", component: frame.component, message: "Unknown component" }),
    );
    return;
  }

  if (_isChecksumRateLimited(ip)) {
    ws.send(
      JSON.stringify({
        type: "error",
        component: frame.component,
        message: "Too many invalid requests",
      }),
    );
    return;
  }

  // The snapshot is hydrated inside the pipeline below rather than here.
  //
  // Hydration asserts that the snapshot belongs to whoever is asking, and that
  // check reads the authenticated user off the request context — which only the
  // Session and Auth middleware can put there, and they have not run yet. Doing
  // it here compares a snapshot issued to a signed-in user against a context
  // with no user at all, so every action on an authenticated page is rejected
  // as somebody else's.

  // ── Persistent middleware (Livewire-style) ──────────────────────────────────
  const pagePath = frame.snapshot.memo.path;
  const middleware = [
    ...deps.globalMiddleware().filter(_isPersistentMiddleware),
    ...Router.middlewareFor("GET", pagePath),
  ];

  const request = new Request(`${ws.data.origin ?? "http://localhost"}${pagePath}`, {
    headers: ws.data.headers ?? new Headers(),
  });

  await deps.container.runScoped(async (scoped) => {
    const ctx = new HttpContext(request, scoped);

    await RequestContext.run(ctx, async () => {
      let passed = false;
      let redirectUrl: string | undefined;

      const DispatchTerminal = class {
        async handle(c: HttpContext, next: NextFn): Promise<Response | void> {
          passed = true;

          // Auth has run by now, so the ownership check has a subject to compare
          // against.
          let page: Component;
          try {
            page = await hydrate(frame.snapshot, entry.PageClass as unknown as new () => Component);
          } catch (e) {
            if (e instanceof FlowIntegrityError) {
              _recordChecksumFailure(ip); // only count actual tampered/invalid snapshots
              ws.send(
                JSON.stringify({
                  type: "error",
                  component: frame.component,
                  message: "Invalid snapshot",
                }),
              );
              if (!c.response) c.response = new Response(null, { status: 400 });
              return next();
            }
            if (e instanceof FlowSnapshotOwnershipError) {
              // Not tampering — the session changed under a page that is still
              // open, which is what signing out in another tab looks like. The
              // page's state belongs to who you were, so reloading is the only
              // honest recovery, and the client is told to do exactly that.
              ws.send(
                JSON.stringify({
                  type: "error",
                  component: frame.component,
                  message: "Your session changed — reload the page.",
                  reload: true,
                }),
              );
              if (!c.response) c.response = new Response(null, { status: 403 });
              return next();
            }
            throw e;
          }

          redirectUrl = await _dispatchFrame(ws, frame, page, entry, c);
          if (!c.response) c.response = new Response(null, { status: 204 });
          return next();
        }
      };

      const _startedAt = performance.now();
      try {
        const pipeline = Pipeline.send<HttpContext>(ctx).through([
          ...middleware,
          DispatchTerminal as unknown as MiddlewareClass,
        ]);
        // The *container* resolves pipes; the scoped resolver is already on the
        // HttpContext above and serves per-request bindings. They are not
        // interchangeable — a ScopedResolver has no `bound()`/`makeSync()`, so
        // passing it here breaks the moment a page's route middleware needs
        // resolving rather than plain construction.
        pipeline.via(deps.container);
        await pipeline.thenReturn();
      } catch (e) {
        _touchConnection(ws, ctx);
        FrameworkEvents.emit(
          new FlowActionHandled(
            frame.component,
            frame.method,
            performance.now() - _startedAt,
            false,
            ip,
            ctx,
          ),
        );
        ws.send(
          JSON.stringify({
            type: "error",
            component: frame.snapshot.memo.id,
            message: e instanceof Error ? e.message : "Request blocked by middleware",
          }),
        );
        return;
      }

      // Action executed — announce it with the request-scoped context (user/ip/queries).
      if (passed) {
        _touchConnection(ws, ctx);
        FrameworkEvents.emit(
          new FlowActionHandled(
            frame.component,
            frame.method,
            performance.now() - _startedAt,
            true,
            ip,
            ctx,
          ),
        );
      }

      if (!passed) {
        const location = ctx.response?.headers.get("Location");
        if (location) {
          ws.send(JSON.stringify({ type: "redirect", url: location }));
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              component: frame.snapshot.memo.id,
              message: `Request blocked by middleware (${ctx.response?.status ?? 403})`,
            }),
          );
        }
        return;
      }

      // Run the response finalizers the HTTP path runs. SessionMiddleware saves
      // the session from one of these, so without this a WS action that mutates
      // the session — signing in, above all — writes no `Set-Cookie` and the
      // change is silently lost the moment the browser navigates.
      if (ctx.response) {
        for (const finalize of ctx._responseFinalizers) {
          try {
            await finalize(ctx.response);
          } catch (error) {
            console.error("[Zerotal] response finalizer failed:", error);
          }
        }
      }

      const setCookieHeader = ctx.response?.headers.get("Set-Cookie");

      if (redirectUrl) {
        if (setCookieHeader) {
          const token = crypto.randomUUID();
          _sessionRelayStore.set(token, {
            setCookie: setCookieHeader,
            expiresAt: Date.now() + 30_000,
          });
          ws.send(JSON.stringify({ type: "redirect", url: redirectUrl, sessionToken: token }));
        } else {
          ws.send(JSON.stringify({ type: "redirect", url: redirectUrl }));
        }
        return;
      }

      // Non-redirect action: if session was mutated, relay the updated cookie to
      // the browser (WebSocket frames cannot carry Set-Cookie directly).
      if (setCookieHeader) {
        const token = crypto.randomUUID();
        _sessionRelayStore.set(token, {
          setCookie: setCookieHeader,
          expiresAt: Date.now() + 30_000,
        });
        ws.send(JSON.stringify({ type: "session", token }));
      }
    });
  });
}

// ── Patch send (delta snapshot + HTML suppression) ────────────────────────────

interface DispatchEffects {
  scripts: string[];
  errors: Record<string, string[]>;
  title: string | null;
}

/** Effects carried by a mid-`@task` streaming patch — none; flashes/events flush at the end. */
const _EMPTY_EFFECTS: DispatchEffects = { scripts: [], errors: {}, title: null };

/**
 * Send a "patch" frame, delta-encoding the snapshot and suppressing `html` when the
 * re-render is byte-identical to the last one on this connection. `prev` is the client's
 * own snapshot (`frame.snapshot`), so the delta reconstructs to exactly what was signed.
 * `html` is undefined for @renderless patches (snapshot-only).
 */
function _sendPatch(
  ws: FlowBunWs,
  componentId: string,
  html: string | undefined,
  next: Snapshot,
  prev: Snapshot,
  effects: DispatchEffects,
  actionError = false,
  partial = false,
): void {
  const delta = encodeSnapshotDelta(prev, next);

  let outHtml = html;
  if (html !== undefined) {
    const hashes = (ws.data.flowHtmlHashes ??= new Map<string, string>());
    const h = Bun.hash(html).toString();
    if (hashes.get(componentId) === h) {
      outHtml = undefined; // unchanged since last patch → let the client keep its DOM
    } else {
      hashes.set(componentId, h);
    }
  }

  ws.send(
    JSON.stringify({
      type: "patch",
      component: componentId,
      ...(outHtml !== undefined ? { html: outHtml } : {}),
      memo: delta.memo,
      checksum: delta.checksum,
      dataDelta: delta.dataDelta,
      dataRemoved: delta.dataRemoved,
      scripts: effects.scripts.length > 0 ? effects.scripts : undefined,
      errors: Object.keys(effects.errors).length > 0 ? effects.errors : undefined,
      title: effects.title ?? undefined,
      ...(actionError ? { actionError: true } : {}),
      ...(partial ? { partial: true } : {}),
    }),
  );

  _logTransport(next, delta, html, outHtml);
}

/** Opt-in dev instrumentation (`ZT_FLOW_TRANSPORT_LOG=1`): show delta vs full payload sizes. */
function _logTransport(
  next: Snapshot,
  delta: SnapshotDelta,
  html: string | undefined,
  sentHtml: string | undefined,
): void {
  if (!Bun.env["ZT_FLOW_TRANSPORT_LOG"]) return;
  const full = Buffer.byteLength(JSON.stringify(next), "utf8");
  const sent = Buffer.byteLength(
    JSON.stringify({ m: delta.memo, c: delta.checksum, d: delta.dataDelta, r: delta.dataRemoved }),
    "utf8",
  );
  const htmlBytes = html ? Buffer.byteLength(html, "utf8") : 0;
  const htmlNote =
    html === undefined
      ? "no html"
      : sentHtml === undefined
        ? `html suppressed (−${htmlBytes}B)`
        : `html ${htmlBytes}B`;
  const changed = Object.keys(delta.dataDelta);
  console.log(
    `[Flow] patch ${next.memo.name}: snapshot ${sent}B (full ${full}B, ` +
      `${changed.length} field${changed.length === 1 ? "" : "s"}: ${changed.join(",") || "—"}), ${htmlNote}`,
  );
}

// ── Frame dispatch (inside middleware pipeline) ───────────────────────────────

/**
 * Execute the action described by `frame`, re-render the page, and push WS
 * messages for flashes, patches, events, downloads, and scripts.
 *
 * @returns The redirect URL if the action called this.redirect(), otherwise undefined.
 */
async function _dispatchFrame(
  ws: FlowBunWs,
  frame: CallFrame,
  page: Component,
  entry: NonNullable<ReturnType<typeof getPage>>,
  ctx: HttpContext,
): Promise<string | undefined> {
  page._isHydrated = true;
  // Use the HMAC-signed id from the snapshot — frame.component is unsigned.
  page._flowId = frame.snapshot.memo.id;
  page._flowPath = frame.snapshot.memo.path;
  page._prevChildIds = frame.snapshot.memo.children ?? [];
  page._childIds = [];

  page._streamSender = (ref, content, replace) => {
    ws.send(JSON.stringify({ type: "stream", ref, content, replace }));
  };

  // The route HttpContext handed to lifecycle hooks. On WebSocket round-trips the request URL is
  // the stored route pattern, so model bindings aren't re-resolved here — bound models persist
  // on the component via synths. We still pass the context for consistency with the initial GET
  // (and controllers), so a hook signature like `onMount(ctx)` remains type-safe even when
  // `ctx.params` is empty.

  // Lifecycle: boot() runs on every request; hydrate() runs only on these
  // subsequent (WebSocket) requests, after state has been restored from the snapshot.
  await page.onBoot(ctx);
  await page.onHydrate();

  // Refill @shared props from the room store (server-authoritative read-latest) so the
  // action operates on the converged value, and snapshot them to detect what it changes.
  // No-op unless the component has @shared props.
  populateShared(page);
  const sharedBefore = snapshotSharedValues(page);

  // True when the action (or a rejected client write) routed to onError — drives the
  // client's `showOnError` failed-state directive (optimistic UI). Validation errors are
  // NOT failures in this sense; they populate the error bag instead.
  let actionErrored = false;

  // Dev-only: the first unexpected error thrown during this dispatch, captured for the client
  // error overlay. Only populated (and sent) under the dev worker — production leaks no stack.
  // A ref object (not a bare `let`) so the capture closure's assignment is visible to the reader.
  const devErrorRef: { current: DevErrorInfo | null } = { current: null };
  const captureDevError = (error: unknown): void => {
    if (!_isDevWorker || devErrorRef.current) return;
    // Skip intended HTTP errors (auth/404/validation carry a numeric status) — the overlay is for
    // unexpected bugs, not for the framework's own control-flow errors.
    if (typeof (error as { status?: unknown } | null)?.status === "number") return;
    devErrorRef.current = _devErrorInfo(error, frame.method);
  };

  // Apply pending flow:model updates from the client through _applyClientUpdate so
  // the @expose / @locked allowlist is enforced (internal _* fields can't be
  // clobbered) AND the updating()/updated() hooks fire around each write. An
  // onUpdating() hook may throw to reject the update — routed to onError().
  for (const [key, value] of Object.entries(frame.updates ?? {})) {
    try {
      await page._applyClientUpdate(key, value);
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        actionErrored = true;
        captureDevError(error);
        try {
          await page.onError(error instanceof Error ? error : new Error(String(error)));
        } catch {
          /* keep going */
        }
      }
    }
  }

  // Guard against malformed frames (non-array args → fn.apply would throw).
  if (!Array.isArray(frame.args)) frame.args = [];

  // If refresh was requested, re-run onMount
  if (page._shouldRefresh) {
    page._shouldRefresh = false;
    await page.onMount(ctx);
  }

  const method = frame.method;
  let skipRender = false;
  const className = entry.PageClass.name;
  const compId = frame.snapshot.memo.id;

  // Delta patches chain against the last snapshot the client received. A running @task advances
  // this base as it streams throttled partial patches; for every other action it stays the
  // client's original snapshot, so their behaviour is unchanged.
  let deltaBase: Snapshot = frame.snapshot;

  if (BUILTIN_ACTIONS.has(method)) {
    if (method === "$set") {
      const [key, value] = frame.args as [string, unknown];
      // A rejected live/blur write (onUpdating throws) must surface the failed state and
      // revert, not crash the dispatch — mirror the deferred-updates loop above.
      try {
        await page._applyClientUpdate(key, value);
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          actionErrored = true;
          captureDevError(error);
          try {
            await page.onError(error instanceof Error ? error : new Error(String(error)));
          } catch {
            /* keep going */
          }
        }
      }
    } else if (method === "$refresh") {
      await page.onMount(ctx);
    } else if (method === "$mount") {
      // Lazy/defer: run onMount() for a component that was initially rendered
      // as a placeholder. The full render happens below.
      await page.onMount(ctx);
    } else if (method === "$rerender") {
      // Dev fast refresh: no-op. hydrate() + onHydrate() already ran above, so the
      // render below reflects the newly-compiled code while preserving snapshot state
      // (onMount is intentionally NOT re-run).
    } else if (method === "$presence") {
      // A presence join/leave occurred — refill the @presence member list(s), then render.
      await populatePresence(page);
    } else if (method === "$shared") {
      // The channel signalled a shared-state change — the read-latest at the top of this
      // dispatch already refilled the @shared prop(s) from the store; just re-render.
    }
  } else {
    const allowed = getAllowedMethods(entry.PageClass as typeof Component);
    if (!allowed.has(method)) {
      ws.send(
        JSON.stringify({
          type: "error",
          component: frame.snapshot.memo.id,
          message: `Method "${method}" is not allowed`,
        }),
      );
      return;
    }

    const renderlessMethods = getRenderlessMethods(entry.PageClass as typeof Component);
    skipRender = renderlessMethods.has(method);

    // @task: while the action runs, stream throttled partial patches of its changing state
    // (so `this.answer += token` appears live) and wire an AbortSignal the client trips via
    // this.cancel(). A @renderless task doesn't stream (no re-render) but still gets cancel.
    const isTask = getTaskMethods(entry.PageClass as typeof Component).has(method);
    let taskController: AbortController | null = null;
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let flushing = false;
    let taskDone = false;

    const flushPartial = (): void => {
      if (flushing || taskDone || skipRender) return;
      flushing = true;
      try {
        // Field-level streaming: serialize the component's current state WITHOUT re-rendering,
        // and send only the changed snapshot fields (no html). Reactive bindings of those fields
        // — `text={this.x}` / `x-text` / `:attr` — update the DOM instantly off the client store;
        // the final (full) patch re-renders once to reconcile any static template positions. This
        // is why a streamed field should be bound reactively for a live view.
        //
        // No render ran, so preserve the client's child ids in the memo (dehydrate reads them),
        // and restore the dispatch's own child-id bookkeeping afterward.
        const savedChildIds = page._childIds;
        page._childIds = [...page._prevChildIds];
        const snap = dehydrate(page, frame.snapshot.memo);
        page._childIds = savedChildIds;
        // Skip when no serialized field changed since the last patch on this connection.
        if (JSON.stringify(snap.data) === JSON.stringify(deltaBase.data)) return;
        _sendPatch(ws, compId, undefined, snap, deltaBase, _EMPTY_EFFECTS, false, true);
        deltaBase = snap;
      } catch {
        /* a mid-stream serialization error is non-fatal — the final patch reports the outcome */
      } finally {
        flushing = false;
      }
    };

    if (isTask) {
      taskController = new AbortController();
      _runningTasks.set(compId, { controller: taskController, owner: ws });
      page._taskSignal = taskController.signal;
      flushTimer = setInterval(flushPartial, TASK_FLUSH_MS);
    }

    try {
      const fn = (page as unknown as Record<string, unknown>)[method] as (
        ...a: unknown[]
      ) => unknown;
      await fn.apply(page, frame.args ?? []);
    } catch (error) {
      if (error instanceof ValidationError) {
        // Validation errors are NOT bugs — store them and continue to re-render.
        // The client will show field-level error messages via $errors.
        // _errors is already set on the page by validate().
      } else {
        actionErrored = true;
        captureDevError(error);
        try {
          await page.onError(error instanceof Error ? error : new Error(String(error)));
        } catch {
          // onError itself threw — still try to send a response
        }
      }
    } finally {
      if (isTask) {
        taskDone = true;
        if (flushTimer) clearInterval(flushTimer);
        _runningTasks.delete(compId);
        page._taskSignal = null;
      }
    }
  }

  await page.onUpdate();

  // Write back any @shared prop the action changed and broadcast it to the channel so other
  // subscribers converge (via a $shared re-read). No-op unless a @shared value changed.
  await commitShared(page, sharedBefore);

  // Persist @session props after every action.
  _persistSessionProps(page, className, ctx);

  const effects = page._drainEffects();

  if (effects.redirectUrl) {
    return effects.redirectUrl;
  }

  // Use the HMAC-signed component id for all outbound frames.
  const canonicalId = compId;

  // Flush flashes — forward the full payload (title/position/duration/icon/…).
  // `component` lets a toast's action/onClose invoke a @expose method on this
  // component over the bridge.
  for (const f of effects.flashes) {
    ws.send(JSON.stringify({ type: "flash", component: canonicalId, ...f }));
  }

  // Dispatch cross-component events (to/self targeting mirrors Livewire's dispatch()->to()/->self()).
  for (const event of effects.events) {
    ws.send(
      JSON.stringify({
        type: "event",
        name: event.name,
        data: event.data,
        to: event.to,
        self: event.self ? canonicalId : undefined,
      }),
    );
  }

  // File downloads
  for (const dl of effects.downloads) {
    ws.send(
      JSON.stringify({
        type: "download",
        filename: dl.filename,
        content: dl.content,
        mime: dl.mime,
      }),
    );
  }

  // Dev-only: an unexpected error was thrown during this action — send its detail (message +
  // stack + action) so the client renders a full-screen error overlay. Gated to the dev worker
  // in captureDevError, so production sends nothing here (no stack leak). The patch still follows,
  // so the component reconciles and `showOnError` fires as usual.
  if (devErrorRef.current) {
    const de = devErrorRef.current;
    ws.send(
      JSON.stringify({
        type: "error",
        component: canonicalId,
        message: de.message,
        name: de.name,
        stack: de.stack,
        action: de.action,
      }),
    );
  }

  // @renderless: send snapshot-only patch (no html)
  if (skipRender) {
    page._childIds = [...page._prevChildIds];
    await page.onDehydrate();
    const snapshot = dehydrate(page, frame.snapshot.memo);
    warnIfLarge(snapshot, frame.snapshot.memo.name);
    await persistDurable(page, ctx, snapshot);
    _sendPatch(ws, canonicalId, undefined, snapshot, deltaBase, effects, actionErrored);
    return undefined;
  }

  // Re-render first (collects nested child ids), then dehydrate.
  const innerHtml = await _renderFlowPage(page, () => page.render());
  await page.onDehydrate();
  const snapshot = dehydrate(page, frame.snapshot.memo);
  warnIfLarge(snapshot, frame.snapshot.memo.name);
  await persistDurable(page, ctx, snapshot);

  const compName = frame.snapshot.memo.name;
  const html = `<div data-flow-root x-data="{}" data-flow-id="${canonicalId}" data-flow-name="${compName}">${innerHtml}</div>`;
  _sendPatch(ws, canonicalId, html, snapshot, deltaBase, effects, actionErrored);
  return undefined;
}

// ── Persistent middleware registry ────────────────────────────────────────────

function _isPersistentMiddleware(mw: MiddlewareClass): boolean {
  for (const entry of FlowProvider.persistentMiddleware) {
    if (typeof entry === "string") {
      let c: unknown = mw;
      while (typeof c === "function") {
        if ((c as { name?: string }).name === entry) return true;
        c = Object.getPrototypeOf(c);
      }
    } else if (mw === entry || Object.prototype.isPrototypeOf.call(entry, mw)) {
      return true;
    }
  }
  return false;
}

// ── FlowProvider ─────────────────────────────────────────────────────────────

/**
 * The service provider that wires Flow (reactive SSR over WebSocket) into a Zerotal app.
 *
 * It registers the `Router.flow()` route macro and the file-route resolver (so `flow` page
 * Components become routes), and in web/worker/test envs stands up the runtime: builds and
 * serves the client bundle at `/__flow/runtime.js`, mounts the WebSocket action handler at
 * `/__flow/ws` (plus the `/__flow/http` fallback, `/__flow/upload`, and the session-relay
 * endpoint), and AOT-compiles registered `render()` methods. In `console`/`repl` envs it boots
 * only far enough to enumerate routes and register the `make:flow` generator. Add it to your
 * app's provider list; it is a dependency of the admin and monitor panels.
 *
 * @example
 * ```ts
 * // bootstrap/providers.ts
 * import { FlowProvider } from "@zerotal/flow";
 *
 * const providers = [
 *   // …session/auth providers first…
 *   FlowProvider,
 * ];
 * export default providers;
 * ```
 *
 * @category Provider
 */
export class FlowProvider extends ServiceProvider {
  // `console`/`repl` are included so that route-enumerating CLI commands (e.g.
  // `route:list`) boot this provider and its onRegister() runs — that registers
  // the file-route resolver which turns `flow` page Components into routes.
  // Without it those pages never appear in any CLI route listing. The heavy
  // web-server setup in onBooting/onBooted/onStarting (client bundle, WebSocket
  // handlers, AOT compile, dev build hooks) is skipped in those envs via
  // _isWebRuntime() below — CLI commands need only the route registrations.
  static override environments: AppEnvironment[] = ["web", "worker", "test", "console", "repl"];

  private _disposeObservability: (() => void) | undefined = undefined;

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
  }

  /** True only in the long-lived envs that actually serve HTTP/WS and render pages.
   *  `console`/`repl` boot the provider just to enumerate routes, so they skip the
   *  web-only lifecycle work below. */
  private _isWebRuntime(): boolean {
    const env = this.app.environment;
    return env !== "console" && env !== "repl";
  }

  /**
   * Global middleware re-applied on every WebSocket update (Livewire-style
   * persistent middleware). Matched against the app's global pipeline by
   * class reference or class name. Route middleware always re-runs and does
   * not need to be listed here.
   */
  static persistentMiddleware: (string | MiddlewareClass)[] = [...DEFAULT_PERSISTENT_MIDDLEWARE];

  /**
   * Add global middleware to the persistent list — middleware re-run on every WebSocket
   * action, matched by class reference or class name.
   *
   * @param middleware - Middleware classes or their names to mark persistent.
   * @category Provider
   *
   * @example
   * ```ts
   * // In a ServiceProvider's register/boot:
   * FlowProvider.persistMiddleware(TenantMiddleware, 'LocaleMiddleware');
   * ```
   */
  static persistMiddleware(...middleware: (string | MiddlewareClass)[]): void {
    FlowProvider.persistentMiddleware.push(...middleware);
  }

  /**
   * Seed the persistent list from `config('flow.persistentMiddleware')` when the app
   * ships a `config/flow.ts`. Anything already added via `persistMiddleware()` is kept
   * on top, so a provider that registered before this one is never dropped.
   */
  private _applyPersistentMiddlewareConfig(): void {
    const configured = config.safe<(string | MiddlewareClass)[]>(
      "flow.persistentMiddleware",
      DEFAULT_PERSISTENT_MIDDLEWARE,
    );
    const added = FlowProvider.persistentMiddleware.filter(
      (mw) => !DEFAULT_PERSISTENT_MIDDLEWARE.includes(mw) && !configured.includes(mw),
    );
    FlowProvider.persistentMiddleware = [...configured, ...added];
  }

  override onRegister(): void {
    this._applyPersistentMiddlewareConfig();
    Router.macro("flow", flowRoute);

    registerFileRouteResolver(({ urlPath, module, middleware, name, filePath }) => {
      const PageClass = _findPageExport(module);
      if (!PageClass) return false;
      // Store source file path so the AOT compiler can read it at boot.
      (PageClass as unknown as Record<string, unknown>).__sourceFile = filePath;
      // `urlPath` already includes the active group prefix (scanFileRoutes prepends it), so
      // register at the absolute path — using Router.get here would apply the prefix twice.
      registerFlowFileRoute(urlPath, PageClass, middleware, name);
      return true;
    });
  }

  override async onBooting(): Promise<void> {
    // CLI envs (console/repl) only need the route registrations from onRegister();
    // skip the HTTP/WS server wiring below.
    if (!this._isWebRuntime()) return;

    // CSP-safe mode (no 'unsafe-eval'): select the CSP client entry, which swaps
    // Alpine's evaluator for the eval-free interpreter. Toggled by env.
    const cspSafe = _isCspSafe();

    // Build the client-side runtime bundle
    try {
      const entryPath = cspSafe ? "../client/index.csp.ts" : "../client/index.ts";
      const entry = fileURLToPath(new URL(entryPath, import.meta.url));
      const result = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        minify: Bun.env["APP_ENV"] === "production",
        format: "esm",
      });

      if (result.success && result.outputs.length > 0) {
        _runtimeBundle = await result.outputs[0]!.text();
      } else {
        console.warn("[Flow] Client bundle build failed:", result.logs);
      }
    } catch (e) {
      console.warn("[Flow] Could not build client bundle:", e);
    }

    // Serve the client-side runtime bundle
    Router.get(
      "/__flow/runtime.js",
      class FlowRuntimeHandler {
        handle(http: HttpContext): void {
          if (!_runtimeBundle) {
            http.response = new Response("// Flow runtime unavailable", {
              status: 503,
              headers: { "Content-Type": "text/javascript; charset=utf-8" },
            });
            return;
          }
          http.response = new Response(_runtimeBundle, {
            status: 200,
            headers: {
              "Content-Type": "text/javascript; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        }
      },
      "handle",
    );

    // One-time HTTP endpoint: client fetches this to apply a session cookie
    // that was mutated by a WS action (WebSocket frames cannot carry Set-Cookie).
    //
    // Registered as a RAW route (no middleware pipeline) so that SessionMiddleware
    // does not run and overwrite the relay's Set-Cookie with a fresh empty session.
    Router.raw("GET", "/__flow/session-relay", (req: Request): Response => {
      const token = new URL(req.url).searchParams.get("t") ?? "";
      const entry = _sessionRelayStore.get(token);
      _sessionRelayStore.delete(token); // one-time use regardless of validity
      if (!entry || entry.expiresAt < Date.now()) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": entry.setCookie },
      });
    });

    // Authenticated file-upload endpoint. Bytes can't ride the WebSocket (JSON-only), so the
    // client POSTs multipart here; we store to the temp disk and return a signed reference the
    // client then $sets onto the bound component property. Goes through the normal middleware
    // pipeline (Session/Auth), so ctx.user is populated.
    Router.post(
      "/__flow/upload",
      class FlowUploadHandler {
        async handle(http: HttpContext): Promise<void> {
          const user = (http as unknown as { user?: unknown }).user;
          if (!user) {
            http.response = Response.json({ error: "Unauthenticated." }, { status: 401 });
            return;
          }
          let form: FormData;
          try {
            form = await http.request.formData();
          } catch {
            http.response = Response.json({ error: "Invalid upload." }, { status: 400 });
            return;
          }
          const entry = form.get("file");
          if (!(entry instanceof File) || !entry.name || entry.size === 0) {
            http.response = Response.json({ error: "No file provided." }, { status: 422 });
            return;
          }
          if (entry.size > MAX_UPLOAD_BYTES) {
            http.response = Response.json(
              { error: "File exceeds the size limit." },
              { status: 422 },
            );
            return;
          }
          const ext = (entry.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const tmpPath = `flow-tmp/${crypto.randomUUID()}${ext ? "." + ext : ""}`;
          const bytes = new Uint8Array(await entry.arrayBuffer());
          try {
            const { Storage } = (await import("@zerotal/core/storage")) as {
              Storage: {
                disk(): {
                  put(p: string, d: Uint8Array, o?: { contentType?: string }): Promise<void>;
                };
              };
            };
            await Storage.disk().put(tmpPath, bytes, {
              contentType: entry.type || "application/octet-stream",
            });
          } catch {
            http.response = Response.json({ error: "Storage is not configured." }, { status: 500 });
            return;
          }
          _tempUploads.set(tmpPath, Date.now() + TEMP_UPLOAD_TTL_MS);
          http.response = Response.json(
            makeSignedRef({
              tmpPath,
              originalName: entry.name,
              mime: entry.type || "application/octet-stream",
              size: entry.size,
            }),
          );
        }
      },
      "handle",
    );

    // Register WebSocket handlers
    const app = this.app as unknown as Application;
    const flowDeps: FlowWsDeps = {
      container: this.app.container,
      globalMiddleware: () => app.globalMiddleware as unknown as MiddlewareClass[],
    };
    (this.app as unknown as Application).withWebSocket(
      _makeFlowWsHandlers(flowDeps),
      (req: Request, server?: unknown) => ({
        flowUrl: new URL(req.url).pathname,
        // Prefer the actual socket IP (not spoofable); fall back to
        // x-forwarded-for only when behind a trusted reverse proxy.
        remoteIp:
          (
            server as { requestIP?: (r: Request) => { address: string } | null } | undefined
          )?.requestIP?.(req)?.address ??
          req.headers.get("x-forwarded-for") ??
          "unknown",
        origin: new URL(req.url).origin,
        headers: req.headers,
      }),
      "/__flow/ws", // path so this coexists with broadcasting's /app/ws (multiplexed by path)
    );

    // HTTP fallback: the exact same action pipeline over a plain POST, for networks (strict
    // corporate proxies) that block WebSocket upgrades. The client switches to this after a few
    // failed WS handshakes. We run `_handleFlowMessage` against a "collecting" fake socket whose
    // `send` gathers the frames it would push, then return them as a JSON array for the client to
    // apply. A raw route (no HTTP middleware pipeline) so the action's own persistent-middleware
    // replay handles auth/session exactly as it does over the socket. Streaming @tasks degrade to a
    // single batched response.
    Router.raw("POST", "/__flow/http", async (req: Request): Promise<Response> => {
      // Raw routes are stored outside the middleware pipeline, so nothing here is covered by
      // CsrfMiddleware — and a cross-origin fetch with `credentials: "include"` and the default
      // `text/plain` content type is a CORS-*simple* request, so there is no preflight to stop
      // it either. Without this check any site the user visits could drive every @expose action
      // their session permits. Mirrors the guard on the WebSocket upgrade.
      if (!isAllowedOrigin(req, app._allowedOrigins())) {
        return new Response("Forbidden origin.", { status: 403 });
      }
      const body = await req.text();
      const frames: unknown[] = [];
      const fakeWs = {
        data: {
          remoteIp: req.headers.get("x-forwarded-for") ?? "unknown",
          origin: new URL(req.url).origin,
          headers: req.headers,
        },
        send(msg: string): void {
          try {
            frames.push(JSON.parse(msg));
          } catch {
            /* non-JSON frame — skip */
          }
        },
      } as unknown as FlowBunWs;

      await _handleFlowMessage(fakeWs, body, flowDeps);

      return new Response(JSON.stringify(frames), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    });
  }

  /**
   * AOT-compile and validate registered Component render() methods.
   *
   * Must run in onStarting() — after Application.boot() — so that
   * _loadFileRoutes() has already set __sourceFile on each page class.
   * Running earlier (onBooting/onBooted) causes all pages to be skipped
   * because __sourceFile is undefined at that point.
   */
  override async onStarting(): Promise<void> {
    // No page rendering happens in CLI envs, so skip the AOT compile pass.
    if (!this._isWebRuntime()) return;
    try {
      const appRoot = process.cwd();
      const { compileRegisteredPages } = await import("../compiler/index.ts");
      await compileRegisteredPages(appRoot, _isCspSafe());
    } catch (e) {
      if (e instanceof Error && e.name === "FlowValidationError") throw e;
      // In CSP-safe mode there is no eval-based runtime fallback, so a compile
      // failure must surface rather than silently degrade.
      if (_isCspSafe()) throw e;
      console.warn("[Flow] AOT compiler error (falling back to runtime):", e);
    }
  }

  /**
   * Register dev build hooks so DevOrchestrator rebuilds CSS and JS bundles
   * when files in `resources/css/` or `resources/js/` change during `serve --dev`.
   *
   * Both hooks are no-ops when the corresponding entry point does not exist,
   * so apps without Tailwind or a JS bundle are unaffected.
   *
   *   resources/css/app.css  →  public/css/app.css  (Tailwind v4)
   *   resources/js/app.js    →  public/js/app.js    (browser ESM bundle)
   */
  override async onBooted(): Promise<void> {
    // Forward Flow's realtime events to whatever observers are installed.
    this._disposeObservability = installFlowObservability(this.app);

    // Register CLI generators when running in console mode (the `commands`
    // runner is only bound then). Done before the web-runtime early-return
    // below, since that path is exactly the CLI case.
    const runner = this.app.container.tryMake("commands") as
      { registerLazy(name: string, thunk: () => Promise<unknown>): void } | undefined;
    if (runner) {
      runner.registerLazy("make:flow", () =>
        import("../commands/MakeFlowCommand.ts").then((m) => m.MakeFlowCommand),
      );
    }

    // Dev asset build hooks are a `serve --dev` concern — irrelevant to CLI envs.
    if (!this._isWebRuntime()) return;

    const cwd = process.cwd();
    const cssEntry = `${cwd}/resources/css/app.css`;
    const cssOutdir = `${cwd}/public/css`;
    const jsEntry = `${cwd}/resources/js/app.js`;
    const jsOutdir = `${cwd}/public/js`;

    const [cssExists, jsExists] = await Promise.all([
      Bun.file(cssEntry).exists(),
      Bun.file(jsEntry).exists(),
    ]);

    if (!cssExists && !jsExists) return;

    const { registerDevBuildHook, buildCssBundle, buildJsBundle } =
      await import("@zerotal/core/dev");

    // Combined hook — DevOrchestrator calls this on any frontend file change.
    // Registered under Flow's own name so it sits alongside, rather than on
    // top of, the build belonging to another view layer: an Inertia app that
    // installs @zerotal/monitor gets Flow through `dependsOn`, and both
    // bundles have to keep rebuilding.
    registerDevBuildHook("flow", async () => {
      const results = await Promise.all([
        cssExists
          ? buildCssBundle(cssEntry, cssOutdir, false)
          : Promise.resolve({ success: true, logs: [] as unknown[] }),
        jsExists
          ? buildJsBundle(jsEntry, jsOutdir, false)
          : Promise.resolve({ success: true, logs: [] as unknown[] }),
      ]);
      const failed = results.flatMap((r) => (r.success ? [] : (r.logs ?? [])));
      return { success: failed.length === 0, logs: failed };
    });

    // Build once at startup so assets are ready before the first request.
    const [cssResult, jsResult] = await Promise.all([
      cssExists
        ? buildCssBundle(cssEntry, cssOutdir, false)
        : Promise.resolve({ success: true, logs: [] as unknown[] }),
      jsExists
        ? buildJsBundle(jsEntry, jsOutdir, false)
        : Promise.resolve({ success: true, logs: [] as unknown[] }),
    ]);

    if (!cssResult.success) console.warn("[Flow] CSS build failed at startup:", ...cssResult.logs);
    if (!jsResult.success) console.warn("[Flow] JS build failed at startup:", ...jsResult.logs);
  }

  /**
   * Register a custom synthesizer (serialization handler for a property type) before the
   * app boots.
   * @param synth - The synthesizer to register.
   * @category Provider
   */
  static registerSynth(synth: import("../synths/index.ts").Synth): void {
    import("../synths/index.ts").then((m) => m.registerSynth(synth));
  }
}

// ── File-route Component detection ─────────────────────────────────────────────────

function _findPageExport(module: Record<string, unknown>): PageClassWithMeta | null {
  const candidates = [module["default"], ...Object.values(module)];
  for (const exp of candidates) {
    if (typeof exp !== "function") continue;
    // Use explicit brand set on Component — avoids false positives from third-party
    // classes that happen to have $set and render methods.
    if ((exp as { __isFlowPage?: boolean }).__isFlowPage === true) {
      return exp as unknown as PageClassWithMeta;
    }
  }
  return null;
}

// ── WS handler factory ────────────────────────────────────────────────────────

// Live count of open Flow WebSocket connections — read by monitoring/ops.
let _activeConnections = 0;

/**
 * Number of currently-open Flow (reactive SSR) WebSocket connections.
 * @returns The live count of open `/__flow/ws` connections.
 * @category Connections
 */
export function flowActiveConnections(): number {
  return _activeConnections;
}

/**
 * One currently-open Flow WebSocket client, enriched as actions identify the user.
 * @category Connections
 */
export interface FlowConnection {
  id: string;
  ip: string;
  /** Authenticated user (email/id), once a re-run-middleware action reveals it. */
  user: string | null;
  connectedAt: number;
  lastActivityAt: number;
  actions: number;
}

// Per-connection registry, keyed by the id stamped on `ws.data.connId` at open.
const _connections = new Map<string, FlowConnection>();

/**
 * Snapshot of currently-connected Flow clients (most-recently-active first).
 * @returns An array of {@link FlowConnection}, sorted by `lastActivityAt` descending.
 * @category Connections
 */
export function flowConnections(): FlowConnection[] {
  return [..._connections.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** Best-effort user identity from a request-scoped HttpContext (set by re-run middleware). */
function _connectionUser(ctx: object | undefined): string | null {
  const u = (ctx as { user?: unknown } | undefined)?.user;
  if (u == null) return null;
  if (typeof u === "string" || typeof u === "number") return String(u);
  if (typeof u === "object") {
    const o = u as Record<string, unknown>;
    const v = o.email ?? o.id ?? o.name;
    return v != null ? String(v) : null;
  }
  return null;
}

/** Record activity on a connection: bump its action count and adopt the user once known. */
function _touchConnection(ws: FlowBunWs, ctx: object | undefined): void {
  const id = ws.data.connId;
  if (!id) return;
  const conn = _connections.get(id);
  if (!conn) return;
  conn.lastActivityAt = Date.now();
  conn.actions++;
  const user = _connectionUser(ctx);
  if (user) conn.user = user;
}

function _makeFlowWsHandlers(deps: FlowWsDeps): WebSocketHandlers {
  return {
    open(ws) {
      const w = ws as FlowBunWs;
      const url = w.data.flowUrl;
      if (url === "/__flow/ws") {
        _activeConnections++;
        const id = crypto.randomUUID();
        w.data.connId = id;
        const now = Date.now();
        _connections.set(id, {
          id,
          ip: w.data.remoteIp ?? "unknown",
          user: null,
          connectedAt: now,
          lastActivityAt: now,
          actions: 0,
        });
        FrameworkEvents.emit(new WebSocketConnected(url));
        // `dev` lets the client soft-refresh (re-render from the held snapshot) on a
        // reconnect after a dev restart, instead of a full reload that loses state.
        w.send(JSON.stringify({ type: "ready", dev: _isDevWorker }));
      }
    },

    message(ws, raw) {
      const url = (ws as FlowBunWs).data.flowUrl;
      if (url !== "/__flow/ws") return;

      const msg = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      // The action round-trip is instrumented inside _handleFlowMessage, where the
      // request-scoped context (user, ip, queries) is available.
      void _handleFlowMessage(ws as FlowBunWs, msg, deps);
    },

    close(ws) {
      const w = ws as FlowBunWs;
      if (w.data?.flowUrl === "/__flow/ws") {
        _activeConnections = Math.max(0, _activeConnections - 1);
        if (w.data.connId) _connections.delete(w.data.connId);
        FrameworkEvents.emit(new WebSocketDisconnected("/__flow/ws"));
      }
    },
  };
}
